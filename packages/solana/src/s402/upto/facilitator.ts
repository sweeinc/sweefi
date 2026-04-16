/**
 * s402 Upto Scheme — Facilitator (Solana)
 *
 * Verifies and settles upto deposit transactions.
 *
 * Verification checks:
 *   1. Scheme validation (must be "upto")
 *   2. Network validation (Solana networks only)
 *   3. Signature recovery — cryptographic proof payer signed the transaction
 *   4. Simulation — would this transaction succeed if submitted?
 *   5. Event-based verification:
 *      - Event originates from expected program (anti-spoofing)
 *      - payer matches recovered signer (prevent impersonation)
 *      - recipient matches requirements.payTo (prevent payment diversion)
 *      - mint matches requirements.asset (prevent worthless token attack)
 *      - maxAmount matches requirements.upto.maxAmount
 *      - settlementDeadline matches requirements.upto.settlementDeadlineMs
 *      - feeBps matches requirements.protocolFeeBps
 *      - settlementCeiling >= estimatedAmount (prevent free-service attack)
 *
 * After settlement, the UptoDeposit account ID is returned as depositId.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402UptoPayload,
} from 's402';
import type { FacilitatorSolanaSigner } from '../../signer.js';
import type { SolanaNetwork } from '../../constants.js';
import { SWEEFI_UPTO_PROGRAM_ID, isSolanaNetwork } from '../../constants.js';
import { extractUptoDepositCreatedEvent } from '../../utils/anchor-events.js';

export class UptoSolanaFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'upto' as const;

  /**
   * @param signer - Facilitator signer for signature verification and TX execution
   * @param programId - SweeFi Upto program ID for event anti-spoofing verification.
   *   Defaults to the devnet program ID. For mainnet, pass the mainnet program ID.
   */
  constructor(
    private readonly signer: FacilitatorSolanaSigner,
    private readonly programId: string = SWEEFI_UPTO_PROGRAM_ID,
  ) {}

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'upto') {
      return { valid: false, invalidReason: 'Expected upto scheme' };
    }

    if (!isSolanaNetwork(requirements.network)) {
      return {
        valid: false,
        invalidReason: `Unsupported network: ${requirements.network}`,
      };
    }

    const uptoPayload = payload as s402UptoPayload;
    const { transaction: serializedTx, maxAmount } = uptoPayload.payload;

    if (!serializedTx) {
      return { valid: false, invalidReason: 'Missing transaction in payload' };
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

      // Event-based verification: extract UptoDepositCreated event from logs
      if (!simResult.logs) {
        return {
          valid: false,
          invalidReason: 'Simulation returned no logs — cannot verify event',
          payerAddress,
        };
      }

      const depositEvent = extractUptoDepositCreatedEvent(simResult.logs, this.programId);

      if (!depositEvent) {
        return {
          valid: false,
          invalidReason: 'No UptoDepositCreated event found from expected program',
          payerAddress,
        };
      }

      // Verify payer matches recovered signer (prevent impersonation)
      if (depositEvent.payer !== payerAddress) {
        return {
          valid: false,
          invalidReason: `Payer mismatch: event=${depositEvent.payer}, signer=${payerAddress}`,
          payerAddress,
        };
      }

      // Verify recipient matches requirements.payTo (prevent payment diversion)
      if (depositEvent.recipient !== requirements.payTo) {
        return {
          valid: false,
          invalidReason: `Recipient mismatch: event=${depositEvent.recipient}, expected=${requirements.payTo}`,
          payerAddress,
        };
      }

      // Verify token mint matches requirements.asset (prevent worthless token attack)
      // The event's mint field is the SPL token address used in the deposit.
      if (depositEvent.mint !== requirements.asset) {
        return {
          valid: false,
          invalidReason: `Mint mismatch: event=${depositEvent.mint}, required=${requirements.asset}`,
          payerAddress,
        };
      }

      // Verify max_amount matches exactly
      if (depositEvent.maxAmount !== BigInt(reqUpto.maxAmount)) {
        return {
          valid: false,
          invalidReason: `Max amount mismatch: event=${depositEvent.maxAmount}, required=${reqUpto.maxAmount}`,
          payerAddress,
        };
      }

      // Verify settlement deadline matches exactly.
      // Note: Solana uses Unix seconds (i64), s402 uses milliseconds.
      const deadlineSec = BigInt(reqUpto.settlementDeadlineMs) / 1000n;
      if (depositEvent.settlementDeadline !== deadlineSec) {
        return {
          valid: false,
          invalidReason: `Deadline mismatch: event=${depositEvent.settlementDeadline}s, required=${deadlineSec}s`,
          payerAddress,
        };
      }

      // Verify fee_bps matches (prevent fee bypass)
      const requiredFeeBps = requirements.protocolFeeBps ?? 0;
      if (depositEvent.feeBps !== requiredFeeBps) {
        return {
          valid: false,
          invalidReason: `Fee mismatch: event=${depositEvent.feeBps}, required=${requiredFeeBps}`,
          payerAddress,
        };
      }

      // Verify settlement_ceiling is high enough (prevent free-service attack).
      // A malicious client could set ceiling=1, pass all checks, then the facilitator
      // can never settle for actual usage — deposit expires, client gets full refund.
      const eventCeiling = depositEvent.settlementCeiling;
      if (eventCeiling > 0n) {
        const minimumCeiling = reqUpto.estimatedAmount
          ? BigInt(reqUpto.estimatedAmount)
          : BigInt(reqUpto.maxAmount);
        if (eventCeiling < minimumCeiling) {
          return {
            valid: false,
            invalidReason: `Settlement ceiling too low: event=${eventCeiling}, minimum=${minimumCeiling}`,
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
  ): Promise<s402SettleResponse> {
    const verification = await this.verify(payload, requirements);
    if (!verification.valid) {
      return { success: false, error: verification.invalidReason };
    }

    const uptoPayload = payload as s402UptoPayload;
    // Type narrowed by isSolanaNetwork() guard above (verify) or validated by verify() (settle)
    const network = requirements.network as SolanaNetwork;

    try {
      const startMs = Date.now();

      const txSignature = await this.signer.executeTransaction(
        uptoPayload.payload.transaction,
        network,
      );

      await this.signer.confirmTransaction(txSignature, network);

      // Populate actualAmount from settlementOverrides (server provides actual usage)
      const actualAmount = requirements.settlementOverrides?.actualAmount;

      return {
        success: true,
        txDigest: txSignature,
        finalityMs: Date.now() - startMs,
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
