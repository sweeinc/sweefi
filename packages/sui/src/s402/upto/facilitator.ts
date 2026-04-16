/**
 * s402 Upto Scheme — Facilitator
 *
 * Verifies and settles upto deposit transactions.
 * The upto flow is: client builds a create-deposit PTB → facilitator verifies
 * via dry-run simulation → facilitator broadcasts to create the UptoDeposit.
 * Later, the server provides the actual usage amount and the facilitator settles.
 *
 * Verification checks:
 *   1. Scheme validation (must be "upto")
 *   2. Upto requirements present (maxAmount, settlementDeadlineMs)
 *   3. Signature recovery (payer = deposit creator)
 *   4. Dry-run simulation (proves deposit creation would succeed on-chain)
 *   5. Event-based verification:
 *      - Event originates from expected package (prevent event spoofing)
 *      - token_type matches requirements.asset (prevent worthless token attack)
 *      - payer matches recovered signer (prevent impersonation)
 *      - recipient matches requirements.payTo (prevent payment diversion)
 *      - max_amount matches requirements.upto.maxAmount
 *      - settlement_deadline_ms matches requirements.upto.settlementDeadlineMs
 *      - fee_micro_pct matches requirements.protocolFeeBps
 *      - settlement_ceiling >= estimatedAmount (or maxAmount if no estimate)
 *        Prevents free-service attack: client sets ceiling=1, facilitator can't settle.
 *
 * Settle populates actualAmount and depositId on the response.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402UptoPayload,
} from 's402';
import type { FacilitatorSuiSigner } from '../../signer.js';
import { coinTypesEqual } from '../../utils.js';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { bpsToMicroPercent } from '../../ptb/assert.js';

export class UptoSuiFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'upto' as const;

  /**
   * @param signer - Facilitator signer for signature verification and TX execution
   * @param packageId - SweeFi Move package ID for event anti-spoofing verification.
   *   Required on all networks. Without it, an attacker can deploy a contract that
   *   emits identically-named events and pass facilitator verification.
   */
  constructor(
    private readonly signer: FacilitatorSuiSigner,
    private readonly packageId: string,
  ) {
    if (!packageId) {
      throw new Error(
        "UptoSuiFacilitatorScheme: packageId is required to prevent event spoofing. " +
        "Set SWEEFI_PACKAGE_ID environment variable."
      );
    }
  }

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'upto') {
      return { valid: false, invalidReason: 'Expected upto scheme' };
    }

    const uptoPayload = payload as s402UptoPayload;
    const { transaction, signature, maxAmount } = uptoPayload.payload;

    if (!transaction || !signature) {
      return { valid: false, invalidReason: 'Missing transaction or signature' };
    }

    // Verify upto-specific requirements are present
    const reqUpto = requirements.upto;
    if (!reqUpto) {
      return { valid: false, invalidReason: 'Requirements missing upto config' };
    }

    // Verify payload maxAmount matches requirements
    if (maxAmount !== reqUpto.maxAmount) {
      return {
        valid: false,
        invalidReason: `maxAmount mismatch: payload=${maxAmount}, required=${reqUpto.maxAmount}`,
      };
    }

    try {
      // Parallel: signature verification + dry-run simulation
      const [payerAddress, dryRunResult] = await Promise.all([
        this.signer.verifySignature(transaction, signature, requirements.network),
        this.signer.simulateTransaction(transaction, requirements.network),
      ]);

      // Check simulation success
      if (dryRunResult.effects?.status?.status !== 'success') {
        return {
          valid: false,
          invalidReason: `Dry-run failed: ${dryRunResult.effects?.status?.error ?? 'unknown'}`,
          payerAddress,
        };
      }

      // Event-based verification: UptoDepositCreated event from dry-run
      const depositEvent = extractUptoDepositCreatedEvent(dryRunResult.events ?? [], this.packageId);

      if (!depositEvent) {
        return {
          valid: false,
          invalidReason: 'No UptoDepositCreated event found in simulation',
          payerAddress,
        };
      }

      // Verify token type matches (prevent worthless token attack)
      if (!coinTypesEqual(depositEvent.token_type, requirements.asset)) {
        return {
          valid: false,
          invalidReason: `Token type mismatch: event=${depositEvent.token_type}, required=${requirements.asset}`,
          payerAddress,
        };
      }

      // Verify payer matches recovered signer (prevent impersonation)
      if (normalizeSuiAddress(depositEvent.payer) !== normalizeSuiAddress(payerAddress)) {
        return {
          valid: false,
          invalidReason: `Payer mismatch: event=${depositEvent.payer}, signer=${payerAddress}`,
          payerAddress,
        };
      }

      // Verify recipient matches requirements.payTo (prevent payment diversion)
      if (normalizeSuiAddress(depositEvent.recipient) !== normalizeSuiAddress(requirements.payTo)) {
        return {
          valid: false,
          invalidReason: `Recipient mismatch: event=${depositEvent.recipient}, expected=${requirements.payTo}`,
          payerAddress,
        };
      }

      // Verify max_amount matches exactly
      if (BigInt(depositEvent.max_amount) !== BigInt(reqUpto.maxAmount)) {
        return {
          valid: false,
          invalidReason: `Max amount mismatch: event=${depositEvent.max_amount}, required=${reqUpto.maxAmount}`,
          payerAddress,
        };
      }

      // Verify settlement deadline matches exactly
      if (BigInt(depositEvent.settlement_deadline_ms) !== BigInt(reqUpto.settlementDeadlineMs)) {
        return {
          valid: false,
          invalidReason: `Deadline mismatch: event=${depositEvent.settlement_deadline_ms}, required=${reqUpto.settlementDeadlineMs}`,
          payerAddress,
        };
      }

      // Verify fee_micro_pct matches (prevent fee bypass)
      const requiredFeeMicroPct = BigInt(bpsToMicroPercent(requirements.protocolFeeBps ?? 0));
      if (BigInt(depositEvent.fee_micro_pct) !== requiredFeeMicroPct) {
        return {
          valid: false,
          invalidReason: `Fee mismatch: event=${depositEvent.fee_micro_pct}, required=${requiredFeeMicroPct}`,
          payerAddress,
        };
      }

      // Verify settlement_ceiling is high enough for expected usage (prevent free-service attack).
      // A malicious client could set ceiling=1, pass all other checks, then the facilitator
      // can never settle for the actual usage — deposit expires, client gets a full refund.
      // The server controls estimatedAmount; if absent, ceiling must be 0 (no ceiling) or >= maxAmount.
      const eventCeiling = BigInt(depositEvent.settlement_ceiling);
      if (eventCeiling > 0n) {
        const minimumCeiling = reqUpto.estimatedAmount
          ? BigInt(reqUpto.estimatedAmount)
          : BigInt(reqUpto.maxAmount);
        if (eventCeiling < minimumCeiling) {
          return {
            valid: false,
            invalidReason: `Settlement ceiling too low: event=${depositEvent.settlement_ceiling}, minimum=${minimumCeiling}`,
            payerAddress,
          };
        }
      }

      return { valid: true, payerAddress };
    } catch (error) {
      return {
        valid: false,
        invalidReason: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  async settle(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
    options?: { skipVerify?: boolean },
  ): Promise<s402SettleResponse> {
    // Defense-in-depth: re-verify (skippable on zero-cost-failure chains like Sui)
    if (!options?.skipVerify) {
      const verification = await this.verify(payload, requirements);
      if (!verification.valid) {
        return { success: false, error: verification.invalidReason };
      }
    }

    const uptoPayload = payload as s402UptoPayload;

    try {
      const startMs = Date.now();

      // Execute the deposit creation transaction on-chain
      const txDigest = await this.signer.executeTransaction(
        uptoPayload.payload.transaction,
        uptoPayload.payload.signature,
        requirements.network,
      );

      // Wait for finality
      await this.signer.waitForTransaction(txDigest, requirements.network);

      const finalityMs = Date.now() - startMs;

      // Extract depositId from the UptoDepositCreated event
      let depositId: string | undefined;
      if (this.signer.getTransactionBlock) {
        const txBlock = await this.signer.getTransactionBlock(txDigest, requirements.network);
        const depositEvent = extractUptoDepositCreatedEvent(txBlock.events ?? [], this.packageId);
        if (depositEvent) {
          depositId = depositEvent.deposit_id;
        }
      }

      // Populate actualAmount from settlementOverrides (server provides actual usage)
      const actualAmount = requirements.settlementOverrides?.actualAmount;

      return {
        success: true,
        txDigest,
        finalityMs,
        depositId,
        actualAmount,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Settlement failed',
      };
    }
  }
}

/** Fields from the UptoDepositCreated Move event (snake_case per Move convention).
 *  Note: fee_recipient is NOT emitted in the event — it's stored on the UptoDeposit
 *  object but not in UptoDepositCreated. The facilitator verifies fee_micro_pct
 *  (the percentage is correct) but cannot verify fee_recipient via dry-run events.
 *  This is consistent with escrow/stream/prepaid facilitators. */
interface UptoDepositCreatedEventData {
  deposit_id: string;
  payer: string;
  recipient: string;
  max_amount: string;
  settlement_ceiling: string;
  settlement_deadline_ms: string;
  fee_micro_pct: string;
  token_type: string;
  timestamp_ms: string;
}

/**
 * Extract UptoDepositCreated event from dry-run or execution results.
 *
 * When packageId is provided, matches the full event type to prevent spoofing
 * from attacker-deployed contracts. When omitted, falls back to suffix matching.
 *
 * SECURITY: Validates all required fields exist before returning. This prevents
 * silent failures if the Move contract emits a different event schema.
 */
function extractUptoDepositCreatedEvent(
  events: Array<{ type: string; parsedJson?: unknown }>,
  packageId?: string,
): UptoDepositCreatedEventData | null {
  const event = packageId
    ? events.find(e => e.type.startsWith(`${packageId}::`) && e.type.endsWith('::UptoDepositCreated'))
    : events.find(e => e.type.endsWith('::upto_deposit::UptoDepositCreated'));
  if (!event?.parsedJson || typeof event.parsedJson !== 'object') return null;

  // Explicit field validation — fail fast on schema mismatch
  const json = event.parsedJson as Record<string, unknown>;
  if (
    typeof json.deposit_id !== 'string' ||
    typeof json.payer !== 'string' ||
    typeof json.recipient !== 'string' ||
    typeof json.max_amount !== 'string' ||
    typeof json.settlement_ceiling !== 'string' ||
    typeof json.settlement_deadline_ms !== 'string' ||
    typeof json.fee_micro_pct !== 'string' ||
    typeof json.token_type !== 'string'
  ) {
    return null; // Schema mismatch — will trigger "No event found" error
  }

  return json as unknown as UptoDepositCreatedEventData;
}
