/**
 * s402 Prepaid Scheme — Facilitator (Solana)
 *
 * Verifies and settles prepaid balance deposit transactions.
 *
 * Verification checks:
 *   1. Scheme validation (must be "prepaid")
 *   2. Network validation (Solana networks only)
 *   3. Signature recovery — cryptographic proof payer signed the transaction
 *   4. Simulation — would this transaction succeed if submitted?
 *   5. Event-based verification:
 *      - Event originates from expected program (anti-spoofing)
 *      - agent matches recovered signer (prevent impersonation)
 *      - provider matches requirements.payTo (prevent free-service attack)
 *      - amount >= requirements.prepaid.minDeposit
 *      - ratePerCall matches requirements.prepaid.ratePerCall
 *      - maxCalls matches requirements.prepaid.maxCalls (if specified)
 *
 * After settlement, the PrepaidBalance account ID is returned as balanceId.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402PrepaidPayload,
} from 's402';
import type { FacilitatorSolanaSigner } from '../../signer.js';
import type { SolanaNetwork } from '../../constants.js';
import { SWEEFI_PREPAID_PROGRAM_ID, isSolanaNetwork } from '../../constants.js';
import { extractPrepaidDepositedEvent } from '../../utils/anchor-events.js';

export class PrepaidSolanaFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'prepaid' as const;

  /**
   * @param signer - Facilitator signer for signature verification and TX execution
   * @param programId - SweeFi Prepaid program ID for event anti-spoofing verification.
   *   Defaults to the devnet program ID. For mainnet, pass the mainnet program ID.
   */
  constructor(
    private readonly signer: FacilitatorSolanaSigner,
    private readonly programId: string = SWEEFI_PREPAID_PROGRAM_ID,
  ) {}

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'prepaid') {
      return { valid: false, invalidReason: 'Expected prepaid scheme' };
    }

    if (!isSolanaNetwork(requirements.network)) {
      return {
        valid: false,
        invalidReason: `Unsupported network: ${requirements.network}`,
      };
    }

    const prepaidPayload = payload as s402PrepaidPayload;
    const { transaction: serializedTx, ratePerCall, maxCalls } = prepaidPayload.payload;

    if (!serializedTx) {
      return { valid: false, invalidReason: 'Missing transaction in payload' };
    }

    // Verify prepaid-specific requirements are present
    const reqPrepaid = requirements.prepaid;
    if (!reqPrepaid) {
      return { valid: false, invalidReason: 'Requirements missing prepaid config' };
    }

    // Verify committed params match requirements
    if (ratePerCall !== reqPrepaid.ratePerCall) {
      return {
        valid: false,
        invalidReason: `Rate mismatch: payload=${ratePerCall}, required=${reqPrepaid.ratePerCall}`,
      };
    }

    // maxCalls: if requirements specify it, payload must match exactly.
    // Use !== undefined (not truthy check) because maxCalls=0 is meaningful.
    if (reqPrepaid.maxCalls !== undefined && maxCalls !== reqPrepaid.maxCalls) {
      return {
        valid: false,
        invalidReason: `MaxCalls mismatch: payload=${maxCalls}, required=${reqPrepaid.maxCalls}`,
      };
    }

    // Type narrowed by isSolanaNetwork() guard above (verify) or validated by verify() (settle)
    const network = requirements.network as SolanaNetwork;

    try {
      const payerAddress = await this.signer.verifyAndGetPayer(serializedTx, network);
      const simResult = await this.signer.simulateTransaction(serializedTx, network);

      if (!simResult.success) {
        return {
          valid: false,
          invalidReason: `Simulation failed: ${JSON.stringify(simResult.err)}`,
          payerAddress,
        };
      }

      // Event-based verification: extract PrepaidDeposited event from logs
      if (!simResult.logs) {
        return {
          valid: false,
          invalidReason: 'Simulation returned no logs — cannot verify event',
          payerAddress,
        };
      }

      const depositEvent = extractPrepaidDepositedEvent(simResult.logs, this.programId);

      if (!depositEvent) {
        return {
          valid: false,
          invalidReason: 'No PrepaidDeposited event found from expected program',
          payerAddress,
        };
      }

      // Verify agent matches recovered signer (prevent impersonation)
      if (depositEvent.agent !== payerAddress) {
        return {
          valid: false,
          invalidReason: `Agent mismatch: event=${depositEvent.agent}, signer=${payerAddress}`,
          payerAddress,
        };
      }

      // Verify provider matches requirements.payTo (prevent free-service attack)
      if (depositEvent.provider !== requirements.payTo) {
        return {
          valid: false,
          invalidReason: `Provider mismatch: event=${depositEvent.provider}, expected=${requirements.payTo}`,
          payerAddress,
        };
      }

      // Verify deposit amount meets minimum
      const depositedAmount = depositEvent.amount;
      const minDeposit = BigInt(reqPrepaid.minDeposit);
      if (depositedAmount < minDeposit) {
        return {
          valid: false,
          invalidReason: `Deposit ${depositedAmount} below minimum ${minDeposit}`,
          payerAddress,
        };
      }

      // Verify rate matches exactly
      if (depositEvent.ratePerCall !== BigInt(reqPrepaid.ratePerCall)) {
        return {
          valid: false,
          invalidReason: `Rate mismatch: event=${depositEvent.ratePerCall}, required=${reqPrepaid.ratePerCall}`,
          payerAddress,
        };
      }

      // Verify maxCalls if specified (use !== undefined, not truthy, because 0 is meaningful)
      if (reqPrepaid.maxCalls !== undefined && depositEvent.maxCalls !== BigInt(reqPrepaid.maxCalls)) {
        return {
          valid: false,
          invalidReason: `MaxCalls mismatch: event=${depositEvent.maxCalls}, required=${reqPrepaid.maxCalls}`,
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
  ): Promise<s402SettleResponse> {
    const verification = await this.verify(payload, requirements);
    if (!verification.valid) {
      return { success: false, error: verification.invalidReason };
    }

    const prepaidPayload = payload as s402PrepaidPayload;
    // Type narrowed by isSolanaNetwork() guard above (verify) or validated by verify() (settle)
    const network = requirements.network as SolanaNetwork;

    try {
      const startMs = Date.now();

      const txSignature = await this.signer.executeTransaction(
        prepaidPayload.payload.transaction,
        network,
      );

      await this.signer.confirmTransaction(txSignature, network);

      return {
        success: true,
        txDigest: txSignature,
        finalityMs: Date.now() - startMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Settlement failed',
      };
    }
  }
}
