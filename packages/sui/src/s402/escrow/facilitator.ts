/**
 * s402 Escrow Scheme — Facilitator
 *
 * Verifies and settles escrow creation transactions.
 * The escrow flow is: client builds a create-escrow PTB → facilitator verifies
 * via dry-run simulation → facilitator broadcasts to create the Escrow object.
 *
 * Verification checks:
 *   1. Scheme validation (must be "escrow")
 *   2. Escrow requirements present (seller, deadlineMs)
 *   3. Signature recovery (buyer = escrow creator)
 *   4. Dry-run simulation (proves escrow creation would succeed on-chain)
 *   5. Event-based verification:
 *      - Event originates from expected package (prevent event spoofing)
 *      - token_type matches requirements.asset (prevent worthless token attack)
 *      - buyer matches recovered signer (prevent impersonation)
 *      - seller matches requirements.escrow.seller (prevent payment diversion)
 *      - amount >= requirements.amount
 *      - deadline_ms matches requirements.escrow.deadlineMs (exact — longer
 *        changes escrow economics by locking seller funds longer)
 *      - arbiter matches if specified in requirements
 *      - fee_micro_pct matches requirements.protocolFeeBps (converted to
 *        micro-percent; prevent fee bypass — client controls this PTB arg)
 *
 * After settlement, the Escrow object ID is returned as escrowId.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402EscrowPayload,
} from 's402';
import type { FacilitatorSuiSigner } from '../../signer.js';
import { coinTypesEqual } from '../../utils.js';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { bpsToMicroPercent } from '../../ptb/assert.js';

export class EscrowSuiFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'escrow' as const;

  /**
   * @param signer - Facilitator signer for signature verification and TX execution
   * @param packageId - SweeFi Move package ID for event anti-spoofing verification.
   *   Required on all networks. Without it, an attacker can deploy a contract that
   *   emits identically-named events and pass facilitator verification.
   *   (V8 audit F-13, hardened to require on all networks in pre-publication audit.)
   */
  constructor(
    private readonly signer: FacilitatorSuiSigner,
    private readonly packageId: string,
  ) {
    if (!packageId) {
      throw new Error(
        "EscrowSuiFacilitatorScheme: packageId is required to prevent event spoofing. " +
        "Set SWEEFI_PACKAGE_ID environment variable."
      );
    }
  }

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'escrow') {
      return { valid: false, invalidReason: 'Expected escrow scheme' };
    }

    const escrowPayload = payload as s402EscrowPayload;
    const { transaction, signature } = escrowPayload.payload;

    if (!transaction || !signature) {
      return { valid: false, invalidReason: 'Missing transaction or signature' };
    }

    // Verify escrow-specific requirements are present
    const reqEscrow = requirements.escrow;
    if (!reqEscrow) {
      return { valid: false, invalidReason: 'Requirements missing escrow config' };
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

      // Event-based verification: EscrowCreated event from dry-run
      const escrowEvent = extractEscrowCreatedEvent(dryRunResult.events ?? [], this.packageId);

      if (!escrowEvent) {
        return {
          valid: false,
          invalidReason: 'No EscrowCreated event found in simulation',
          payerAddress,
        };
      }

      // Verify token type matches (prevent worthless token attack)
      if (!coinTypesEqual(escrowEvent.token_type, requirements.asset)) {
        return {
          valid: false,
          invalidReason: `Token type mismatch: event=${escrowEvent.token_type}, required=${requirements.asset}`,
          payerAddress,
        };
      }

      // Verify buyer matches recovered signer (prevent impersonation)
      // Normalized to handle potential format differences (short vs full-length addresses)
      if (normalizeSuiAddress(escrowEvent.buyer) !== normalizeSuiAddress(payerAddress)) {
        return {
          valid: false,
          invalidReason: `Buyer mismatch: event=${escrowEvent.buyer}, signer=${payerAddress}`,
          payerAddress,
        };
      }

      // Verify seller matches requirements (prevent payment diversion)
      if (normalizeSuiAddress(escrowEvent.seller) !== normalizeSuiAddress(reqEscrow.seller)) {
        return {
          valid: false,
          invalidReason: `Seller mismatch: event=${escrowEvent.seller}, expected=${reqEscrow.seller}`,
          payerAddress,
        };
      }

      // Verify amount meets minimum
      const amount = BigInt(escrowEvent.amount);
      const requiredAmount = BigInt(requirements.amount);
      if (amount < requiredAmount) {
        return {
          valid: false,
          invalidReason: `Amount ${amount} below required ${requiredAmount}`,
          payerAddress,
        };
      }

      // Verify deadline matches exactly (longer deadline changes escrow economics —
      // seller is locked for longer; shorter deadline could force premature release)
      if (BigInt(escrowEvent.deadline_ms) !== BigInt(reqEscrow.deadlineMs)) {
        return {
          valid: false,
          invalidReason: `Deadline mismatch: event=${escrowEvent.deadline_ms}, required=${reqEscrow.deadlineMs}`,
          payerAddress,
        };
      }

      // Verify arbiter if specified in requirements
      if (reqEscrow.arbiter && normalizeSuiAddress(escrowEvent.arbiter) !== normalizeSuiAddress(reqEscrow.arbiter)) {
        return {
          valid: false,
          invalidReason: `Arbiter mismatch: event=${escrowEvent.arbiter}, required=${reqEscrow.arbiter}`,
          payerAddress,
        };
      }

      // Verify fee_micro_pct matches (prevent fee bypass — client controls this PTB arg,
      // so a dishonest client could set fee_micro_pct=0 to skip protocol fees).
      // Convert from s402 wire format bps (10,000 = 100%) to Move micro-percent (1,000,000 = 100%).
      const requiredFeeMicroPct = BigInt(bpsToMicroPercent(requirements.protocolFeeBps ?? 0));
      if (BigInt(escrowEvent.fee_micro_pct) !== requiredFeeMicroPct) {
        return {
          valid: false,
          invalidReason: `Fee mismatch: event=${escrowEvent.fee_micro_pct}, required=${requiredFeeMicroPct}`,
          payerAddress,
        };
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

    const escrowPayload = payload as s402EscrowPayload;

    try {
      const startMs = Date.now();

      // Execute the escrow creation transaction on-chain
      const txDigest = await this.signer.executeTransaction(
        escrowPayload.payload.transaction,
        escrowPayload.payload.signature,
        requirements.network,
      );

      // Wait for finality
      await this.signer.waitForTransaction(txDigest, requirements.network);

      const finalityMs = Date.now() - startMs;

      // Extract escrowId from the EscrowCreated event.
      // Uses the optional getTransactionBlock method — if not available, the server
      // can query the transaction effects directly using the txDigest.
      let escrowId: string | undefined;
      if (this.signer.getTransactionBlock) {
        const txBlock = await this.signer.getTransactionBlock(txDigest, requirements.network);
        const escrowEvent = extractEscrowCreatedEvent(txBlock.events ?? [], this.packageId);
        if (escrowEvent) {
          escrowId = escrowEvent.escrow_id;
        }
      }

      return {
        success: true,
        txDigest,
        finalityMs,
        escrowId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Settlement failed',
      };
    }
  }
}

/** Fields from the EscrowCreated Move event (snake_case per Move convention) */
interface EscrowCreatedEventData {
  escrow_id: string;
  buyer: string;
  seller: string;
  arbiter: string;
  amount: string;
  deadline_ms: string;
  fee_micro_pct: string;
  token_type: string;
  /** On-chain clock timestamp — informational, not attacker-controlled */
  timestamp_ms: string;
}

/**
 * Extract EscrowCreated event from dry-run or execution results.
 *
 * When packageId is provided, matches the full event type to prevent spoofing
 * from attacker-deployed contracts. When omitted, falls back to suffix matching.
 *
 * SECURITY: Validates all required fields exist before returning. This prevents
 * silent failures if the Move contract emits a different event schema.
 */
function extractEscrowCreatedEvent(
  events: Array<{ type: string; parsedJson?: unknown }>,
  packageId?: string,
): EscrowCreatedEventData | null {
  const event = packageId
    ? events.find(e => e.type.startsWith(`${packageId}::`) && e.type.endsWith('::EscrowCreated'))
    : events.find(e => e.type.endsWith('::escrow::EscrowCreated'));
  if (!event?.parsedJson || typeof event.parsedJson !== 'object') return null;

  // Explicit field validation — fail fast on schema mismatch
  const json = event.parsedJson as Record<string, unknown>;
  if (
    typeof json.escrow_id !== 'string' ||
    typeof json.buyer !== 'string' ||
    typeof json.seller !== 'string' ||
    typeof json.arbiter !== 'string' ||
    typeof json.amount !== 'string' ||
    typeof json.deadline_ms !== 'string' ||
    typeof json.fee_micro_pct !== 'string' ||
    typeof json.token_type !== 'string'
  ) {
    return null; // Schema mismatch — will trigger "No event found" error
  }

  return json as unknown as EscrowCreatedEventData;
}
