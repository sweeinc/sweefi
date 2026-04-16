/**
 * s402 Stream Scheme — Facilitator
 *
 * Verifies and settles stream creation transactions.
 * The stream flow is: client builds a create-stream PTB → facilitator verifies
 * via dry-run simulation → facilitator broadcasts to create the StreamMeter.
 *
 * Verification checks:
 *   1. Scheme validation (must be "stream")
 *   2. Stream requirements present (ratePerSecond, budgetCap, minDeposit)
 *   3. Signature recovery (payer = stream creator)
 *   4. Dry-run simulation (proves stream creation would succeed on-chain)
 *   5. Event-based verification:
 *      - Event originates from expected package (prevent event spoofing)
 *      - token_type matches requirements.asset (prevent worthless token attack)
 *      - payer matches recovered signer (prevent impersonation)
 *      - recipient matches requirements.payTo (prevent payment diversion)
 *      - deposit >= requirements.stream.minDeposit
 *      - rate_per_second matches requirements.stream.ratePerSecond
 *      - budget_cap >= requirements.stream.budgetCap
 *      - fee_micro_pct matches requirements.protocolFeeBps (converted to
 *        micro-percent; prevent fee bypass — client controls this PTB arg)
 *
 * After settlement, the StreamMeter (meter_id) is returned as streamId
 * so the server can track the stream for ongoing access.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402StreamPayload,
} from 's402';
import type { FacilitatorSuiSigner } from '../../signer.js';
import { coinTypesEqual } from '../../utils.js';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { bpsToMicroPercent } from '../../ptb/assert.js';

export class StreamSuiFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'stream' as const;

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
        "StreamSuiFacilitatorScheme: packageId is required to prevent event spoofing. " +
        "Set SWEEFI_PACKAGE_ID environment variable."
      );
    }
  }

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'stream') {
      return { valid: false, invalidReason: 'Expected stream scheme' };
    }

    const streamPayload = payload as s402StreamPayload;
    const { transaction, signature } = streamPayload.payload;

    if (!transaction || !signature) {
      return { valid: false, invalidReason: 'Missing transaction or signature' };
    }

    // Verify stream-specific requirements are present
    const reqStream = requirements.stream;
    if (!reqStream) {
      return { valid: false, invalidReason: 'Requirements missing stream config' };
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

      // Event-based verification: StreamCreated event from dry-run
      const streamEvent = extractStreamCreatedEvent(dryRunResult.events ?? [], this.packageId);

      if (!streamEvent) {
        return {
          valid: false,
          invalidReason: 'No StreamCreated event found in simulation',
          payerAddress,
        };
      }

      // Verify token type matches (prevent worthless token attack)
      if (!coinTypesEqual(streamEvent.token_type, requirements.asset)) {
        return {
          valid: false,
          invalidReason: `Token type mismatch: event=${streamEvent.token_type}, required=${requirements.asset}`,
          payerAddress,
        };
      }

      // Verify payer matches recovered signer (prevent impersonation)
      // Normalized to handle potential format differences (short vs full-length addresses)
      if (normalizeSuiAddress(streamEvent.payer) !== normalizeSuiAddress(payerAddress)) {
        return {
          valid: false,
          invalidReason: `Payer mismatch: event=${streamEvent.payer}, signer=${payerAddress}`,
          payerAddress,
        };
      }

      // Verify recipient matches requirements.payTo (prevent payment diversion)
      if (normalizeSuiAddress(streamEvent.recipient) !== normalizeSuiAddress(requirements.payTo)) {
        return {
          valid: false,
          invalidReason: `Recipient mismatch: event=${streamEvent.recipient}, expected=${requirements.payTo}`,
          payerAddress,
        };
      }

      // Verify deposit meets minimum
      const deposit = BigInt(streamEvent.deposit);
      const minDeposit = BigInt(reqStream.minDeposit);
      if (deposit < minDeposit) {
        return {
          valid: false,
          invalidReason: `Deposit ${deposit} below minimum ${minDeposit}`,
          payerAddress,
        };
      }

      // Verify rate matches exactly (prevents cheap-rate attack)
      // Uses BigInt to handle leading zeros and formatting differences
      if (BigInt(streamEvent.rate_per_second) !== BigInt(reqStream.ratePerSecond)) {
        return {
          valid: false,
          invalidReason: `Rate mismatch: event=${streamEvent.rate_per_second}, required=${reqStream.ratePerSecond}`,
          payerAddress,
        };
      }

      // Verify budget cap meets minimum
      const budgetCap = BigInt(streamEvent.budget_cap);
      const requiredCap = BigInt(reqStream.budgetCap);
      if (budgetCap < requiredCap) {
        return {
          valid: false,
          invalidReason: `Budget cap ${budgetCap} below required ${requiredCap}`,
          payerAddress,
        };
      }

      // Verify fee_micro_pct matches (prevent fee bypass — client controls this PTB arg,
      // so a dishonest client could set fee_micro_pct=0 to skip protocol fees).
      // Convert from s402 wire format bps (10,000 = 100%) to Move micro-percent (1,000,000 = 100%).
      const requiredFeeMicroPct = BigInt(bpsToMicroPercent(requirements.protocolFeeBps ?? 0));
      if (BigInt(streamEvent.fee_micro_pct) !== requiredFeeMicroPct) {
        return {
          valid: false,
          invalidReason: `Fee mismatch: event=${streamEvent.fee_micro_pct}, required=${requiredFeeMicroPct}`,
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

    const streamPayload = payload as s402StreamPayload;

    try {
      const startMs = Date.now();

      // Execute the stream creation transaction on-chain
      const txDigest = await this.signer.executeTransaction(
        streamPayload.payload.transaction,
        streamPayload.payload.signature,
        requirements.network,
      );

      // Wait for finality
      await this.signer.waitForTransaction(txDigest, requirements.network);

      const finalityMs = Date.now() - startMs;

      // Extract streamId (meter_id) from the StreamCreated event.
      // Uses the optional getTransactionBlock method — if not available, the server
      // can query the transaction effects directly using the txDigest.
      let streamId: string | undefined;
      if (this.signer.getTransactionBlock) {
        const txBlock = await this.signer.getTransactionBlock(txDigest, requirements.network);
        const streamEvent = extractStreamCreatedEvent(txBlock.events ?? [], this.packageId);
        if (streamEvent) {
          streamId = streamEvent.meter_id;
        }
      }

      return {
        success: true,
        txDigest,
        finalityMs,
        streamId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Settlement failed',
      };
    }
  }
}

/** Fields from the StreamCreated Move event (snake_case per Move convention) */
interface StreamCreatedEventData {
  meter_id: string;
  payer: string;
  recipient: string;
  deposit: string;
  rate_per_second: string;
  budget_cap: string;
  fee_micro_pct: string;
  token_type: string;
  /** On-chain clock timestamp — informational, not attacker-controlled */
  timestamp_ms: string;
}

/**
 * Extract StreamCreated event from dry-run or execution results.
 *
 * When packageId is provided, matches the full event type to prevent spoofing
 * from attacker-deployed contracts. When omitted, falls back to suffix matching.
 *
 * SECURITY: Validates all required fields exist before returning. This prevents
 * silent failures if the Move contract emits a different event schema.
 */
function extractStreamCreatedEvent(
  events: Array<{ type: string; parsedJson?: unknown }>,
  packageId?: string,
): StreamCreatedEventData | null {
  const event = packageId
    ? events.find(e => e.type.startsWith(`${packageId}::`) && e.type.endsWith('::StreamCreated'))
    : events.find(e => e.type.endsWith('::stream::StreamCreated'));
  if (!event?.parsedJson || typeof event.parsedJson !== 'object') return null;

  // Explicit field validation — fail fast on schema mismatch
  const json = event.parsedJson as Record<string, unknown>;
  if (
    typeof json.meter_id !== 'string' ||
    typeof json.payer !== 'string' ||
    typeof json.recipient !== 'string' ||
    typeof json.deposit !== 'string' ||
    typeof json.rate_per_second !== 'string' ||
    typeof json.budget_cap !== 'string' ||
    typeof json.fee_micro_pct !== 'string' ||
    typeof json.token_type !== 'string'
  ) {
    return null; // Schema mismatch — will trigger "No event found" error
  }

  return json as unknown as StreamCreatedEventData;
}
