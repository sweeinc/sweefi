/**
 * s402 Prepaid Scheme — Facilitator
 *
 * Verifies and settles prepaid deposit transactions.
 * The prepaid flow is: agent builds a deposit PTB → facilitator verifies via
 * dry-run simulation → facilitator broadcasts to create the PrepaidBalance.
 *
 * Verification checks:
 *   1. Scheme validation (must be "prepaid")
 *   2. Signature recovery (payer = agent depositing funds)
 *   3. Dry-run simulation (proves deposit would succeed on-chain)
 *   4. Event-based verification:
 *      - Event originates from expected package (prevent event spoofing)
 *      - token_type matches requirements.asset (prevent worthless token attack)
 *      - agent matches recovered signer (prevent impersonation)
 *      - provider matches requirements.payTo (prevent free-service attack)
 *      - deposit amount >= requirements.prepaid.minDeposit
 *      - fee_micro_pct matches requirements.protocolFeeBps (converted to
 *        micro-percent; prevent fee bypass — client controls this PTB arg)
 *   5. Rate/maxCalls commitment match (payload params match requirements)
 *
 * After settlement, the PrepaidBalance shared object ID is returned
 * so the server can track claims against it.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402PrepaidPayload,
} from 's402';
import type { FacilitatorSuiSigner } from '../../signer.js';
import { coinTypesEqual } from '../../utils.js';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { bpsToMicroPercent } from '../../ptb/assert.js';

export class PrepaidSuiFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'prepaid' as const;

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
        "PrepaidSuiFacilitatorScheme: packageId is required to prevent event spoofing. " +
        "Set SWEEFI_PACKAGE_ID environment variable."
      );
    }
  }

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'prepaid') {
      return { valid: false, invalidReason: 'Expected prepaid scheme' };
    }

    const prepaidPayload = payload as s402PrepaidPayload;
    const { transaction, signature, ratePerCall, maxCalls } = prepaidPayload.payload;

    if (!transaction || !signature) {
      return { valid: false, invalidReason: 'Missing transaction or signature' };
    }

    // Verify committed params match requirements
    const reqPrepaid = requirements.prepaid;
    if (!reqPrepaid) {
      return { valid: false, invalidReason: 'Requirements missing prepaid config' };
    }

    if (ratePerCall !== reqPrepaid.ratePerCall) {
      return {
        valid: false,
        invalidReason: `Rate mismatch: payload=${ratePerCall}, required=${reqPrepaid.ratePerCall}`,
      };
    }

    // maxCalls: if requirements specify it, payload must match
    if (reqPrepaid.maxCalls && maxCalls !== reqPrepaid.maxCalls) {
      return {
        valid: false,
        invalidReason: `MaxCalls mismatch: payload=${maxCalls}, required=${reqPrepaid.maxCalls}`,
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

      // Event-based verification: the PrepaidDeposited event emitted by the Move
      // contract is the authoritative source for deposit parameters. This is superior
      // to balance-change inspection because:
      //   1. Events contain the exact deposit amount (no gas fee confusion)
      //   2. Events contain the provider address (enables provider verification)
      //   3. Events are emitted by the contract itself (single source of truth)
      const depositEvent = extractDepositEvent(dryRunResult.events ?? [], this.packageId);

      if (!depositEvent) {
        return {
          valid: false,
          invalidReason: 'No PrepaidDeposited event found in simulation',
          payerAddress,
        };
      }

      // Verify token type matches (prevent worthless token attack — client could
      // deposit a custom token with the same name but zero value)
      if (!coinTypesEqual(depositEvent.token_type, requirements.asset)) {
        return {
          valid: false,
          invalidReason: `Token type mismatch: event=${depositEvent.token_type}, required=${requirements.asset}`,
          payerAddress,
        };
      }

      // Verify agent matches recovered signer (prevent impersonation)
      // Normalized to handle potential format differences (short vs full-length addresses)
      if (normalizeSuiAddress(depositEvent.agent) !== normalizeSuiAddress(payerAddress)) {
        return {
          valid: false,
          invalidReason: `Agent mismatch: event=${depositEvent.agent}, signer=${payerAddress}`,
          payerAddress,
        };
      }

      // Verify deposit targets the correct provider (prevents free-service attack
      // where client sets provider=self, gets access, then claims back their deposit)
      if (normalizeSuiAddress(depositEvent.provider) !== normalizeSuiAddress(requirements.payTo)) {
        return {
          valid: false,
          invalidReason: `Provider mismatch: deposit targets ${depositEvent.provider}, expected ${requirements.payTo}`,
          payerAddress,
        };
      }

      // Verify deposit amount meets minimum
      const depositedAmount = BigInt(depositEvent.amount);
      const minDeposit = BigInt(reqPrepaid.minDeposit);
      if (depositedAmount < minDeposit) {
        return {
          valid: false,
          invalidReason: `Deposit ${depositedAmount} below minimum ${minDeposit}`,
          payerAddress,
        };
      }

      // Verify fee_micro_pct matches (prevent fee bypass — client controls this PTB arg,
      // so a dishonest client could set fee_micro_pct=0 to skip protocol fees).
      // Convert from s402 wire format bps (10,000 = 100%) to Move micro-percent (1,000,000 = 100%).
      const requiredFeeMicroPct = BigInt(bpsToMicroPercent(requirements.protocolFeeBps ?? 0));
      if (BigInt(depositEvent.fee_micro_pct) !== requiredFeeMicroPct) {
        return {
          valid: false,
          invalidReason: `Fee mismatch: event=${depositEvent.fee_micro_pct}, required=${requiredFeeMicroPct}`,
          payerAddress,
        };
      }

      // v0.2: lightweight pubkey format validation when requirements indicate
      // signed receipt mode. The actual pubkey binding is enforced by the Move
      // contract when creating the PrepaidBalance object — both deposit() and
      // deposit_with_receipts() emit the same PrepaidDeposited event, so
      // extractDepositEvent() handles both v0.1 and v0.2 transparently.
      if (reqPrepaid.providerPubkey) {
        const clean = reqPrepaid.providerPubkey.replace(/^0x/, '');
        if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
          return {
            valid: false,
            invalidReason: `Invalid providerPubkey format: expected 32-byte hex, got ${clean.length / 2} bytes`,
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

    const prepaidPayload = payload as s402PrepaidPayload;

    try {
      const startMs = Date.now();

      // Execute the deposit transaction on-chain
      const txDigest = await this.signer.executeTransaction(
        prepaidPayload.payload.transaction,
        prepaidPayload.payload.signature,
        requirements.network,
      );

      // Wait for finality
      await this.signer.waitForTransaction(txDigest, requirements.network);

      const finalityMs = Date.now() - startMs;

      // Extract balanceId from the PrepaidDeposited event in the settled transaction.
      // Uses the optional getTransactionBlock method — if not available, the server
      // can query the transaction effects directly using the txDigest.
      let balanceId: string | undefined;
      if (this.signer.getTransactionBlock) {
        const txBlock = await this.signer.getTransactionBlock(txDigest, requirements.network);
        const depositEvent = extractDepositEvent(txBlock.events ?? [], this.packageId);
        if (depositEvent) {
          balanceId = depositEvent.balance_id;
        }
      }

      return {
        success: true,
        txDigest,
        finalityMs,
        balanceId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Settlement failed',
      };
    }
  }
}

/** Fields from the PrepaidDeposited Move event (snake_case per Move convention) */
interface DepositEventData {
  balance_id: string;
  agent: string;
  provider: string;
  amount: string;
  rate_per_call: string;
  max_calls: string;
  fee_micro_pct: string;
  token_type: string;
  timestamp_ms: string;
}

/**
 * Extract PrepaidDeposited event from dry-run or execution results.
 *
 * When packageId is provided, matches the full event type to prevent spoofing
 * from attacker-deployed contracts. When omitted, falls back to suffix matching.
 *
 * SECURITY: Validates all required fields exist before returning. This prevents
 * silent failures if the Move contract emits a different event schema.
 */
function extractDepositEvent(
  events: Array<{ type: string; parsedJson?: unknown }>,
  packageId?: string,
): DepositEventData | null {
  const event = packageId
    ? events.find(e => e.type.startsWith(`${packageId}::`) && e.type.endsWith('::PrepaidDeposited'))
    : events.find(e => e.type.endsWith('::prepaid::PrepaidDeposited'));
  if (!event?.parsedJson || typeof event.parsedJson !== 'object') return null;

  // Explicit field validation — fail fast on schema mismatch
  const json = event.parsedJson as Record<string, unknown>;
  if (
    typeof json.balance_id !== 'string' ||
    typeof json.agent !== 'string' ||
    typeof json.provider !== 'string' ||
    typeof json.amount !== 'string' ||
    typeof json.rate_per_call !== 'string' ||
    typeof json.max_calls !== 'string' ||
    typeof json.fee_micro_pct !== 'string' ||
    typeof json.token_type !== 'string'
  ) {
    return null; // Schema mismatch — will trigger "No event found" error
  }

  return json as unknown as DepositEventData;
}
