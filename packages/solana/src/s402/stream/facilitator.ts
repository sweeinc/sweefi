/**
 * s402 Stream Scheme — Facilitator (Solana)
 *
 * Verifies and settles stream creation transactions.
 *
 * Verification checks:
 *   1. Scheme validation (must be "stream")
 *   2. Network validation (Solana networks only)
 *   3. Signature recovery — cryptographic proof payer signed the transaction
 *   4. Simulation — would this transaction succeed if submitted?
 *   5. Event-based verification:
 *      - Event originates from expected program (anti-spoofing)
 *      - payer matches recovered signer (prevent impersonation)
 *      - recipient matches requirements.payTo (prevent payment diversion)
 *      - deposit >= requirements.stream.minDeposit
 *      - ratePerSecond matches requirements.stream.ratePerSecond
 *      - budgetCap >= requirements.stream.budgetCap
 *
 * After settlement, the StreamMeter account ID is returned as streamId.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402StreamPayload,
} from 's402';
import type { FacilitatorSolanaSigner } from '../../signer.js';
import type { SolanaNetwork } from '../../constants.js';
import { SWEEFI_STREAM_PROGRAM_ID, isSolanaNetwork } from '../../constants.js';
import { extractStreamCreatedEvent } from '../../utils/anchor-events.js';

export class StreamSolanaFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'stream' as const;

  /**
   * @param signer - Facilitator signer for signature verification and TX execution
   * @param programId - SweeFi Stream program ID for event anti-spoofing verification.
   *   Defaults to the devnet program ID. For mainnet, pass the mainnet program ID.
   */
  constructor(
    private readonly signer: FacilitatorSolanaSigner,
    private readonly programId: string = SWEEFI_STREAM_PROGRAM_ID,
  ) {}

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'stream') {
      return { valid: false, invalidReason: 'Expected stream scheme' };
    }

    if (!isSolanaNetwork(requirements.network)) {
      return {
        valid: false,
        invalidReason: `Unsupported network: ${requirements.network}`,
      };
    }

    const streamPayload = payload as s402StreamPayload;
    const { transaction: serializedTx } = streamPayload.payload;

    if (!serializedTx) {
      return { valid: false, invalidReason: 'Missing transaction in payload' };
    }

    // Verify stream-specific requirements are present
    const reqStream = requirements.stream;
    if (!reqStream) {
      return { valid: false, invalidReason: 'Requirements missing stream config' };
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

      // Event-based verification: extract StreamCreated event from logs
      if (!simResult.logs) {
        return {
          valid: false,
          invalidReason: 'Simulation returned no logs — cannot verify event',
          payerAddress,
        };
      }

      const streamEvent = extractStreamCreatedEvent(simResult.logs, this.programId);

      if (!streamEvent) {
        return {
          valid: false,
          invalidReason: 'No StreamCreated event found from expected program',
          payerAddress,
        };
      }

      // Verify payer matches recovered signer (prevent impersonation)
      if (streamEvent.payer !== payerAddress) {
        return {
          valid: false,
          invalidReason: `Payer mismatch: event=${streamEvent.payer}, signer=${payerAddress}`,
          payerAddress,
        };
      }

      // Verify recipient matches requirements.payTo (prevent payment diversion)
      if (streamEvent.recipient !== requirements.payTo) {
        return {
          valid: false,
          invalidReason: `Recipient mismatch: event=${streamEvent.recipient}, expected=${requirements.payTo}`,
          payerAddress,
        };
      }

      // Verify deposit meets minimum
      const deposit = streamEvent.deposit;
      const minDeposit = BigInt(reqStream.minDeposit);
      if (deposit < minDeposit) {
        return {
          valid: false,
          invalidReason: `Deposit ${deposit} below minimum ${minDeposit}`,
          payerAddress,
        };
      }

      // Verify rate matches exactly (prevents cheap-rate attack)
      if (streamEvent.ratePerSecond !== BigInt(reqStream.ratePerSecond)) {
        return {
          valid: false,
          invalidReason: `Rate mismatch: event=${streamEvent.ratePerSecond}, required=${reqStream.ratePerSecond}`,
          payerAddress,
        };
      }

      // Verify budget cap meets minimum
      const budgetCap = streamEvent.budgetCap;
      const requiredCap = BigInt(reqStream.budgetCap);
      if (budgetCap < requiredCap) {
        return {
          valid: false,
          invalidReason: `Budget cap ${budgetCap} below required ${requiredCap}`,
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

    const streamPayload = payload as s402StreamPayload;
    // Type narrowed by isSolanaNetwork() guard above (verify) or validated by verify() (settle)
    const network = requirements.network as SolanaNetwork;

    try {
      const startMs = Date.now();

      const txSignature = await this.signer.executeTransaction(
        streamPayload.payload.transaction,
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
