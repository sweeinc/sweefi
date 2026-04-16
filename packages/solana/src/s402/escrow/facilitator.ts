/**
 * s402 Escrow Scheme — Facilitator (Solana)
 *
 * Verifies and settles escrow creation transactions.
 *
 * Verification checks:
 *   1. Scheme validation (must be "escrow")
 *   2. Network validation (Solana networks only)
 *   3. Signature recovery — cryptographic proof buyer signed the transaction
 *   4. Simulation — would this transaction succeed if submitted?
 *   5. Event-based verification:
 *      - Event originates from expected program (anti-spoofing)
 *      - buyer matches recovered signer (prevent impersonation)
 *      - seller matches requirements.escrow.seller (prevent payment diversion)
 *      - amount >= requirements.amount
 *      - deadline matches requirements.escrow.deadlineMs (exact — longer changes economics)
 *      - arbiter matches if specified in requirements
 *
 * After settlement, the Escrow account ID is returned as escrowId.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402EscrowPayload,
} from 's402';
import type { FacilitatorSolanaSigner } from '../../signer.js';
import type { SolanaNetwork } from '../../constants.js';
import { SWEEFI_ESCROW_PROGRAM_ID, isSolanaNetwork } from '../../constants.js';
import { extractEscrowCreatedEvent } from '../../utils/anchor-events.js';

export class EscrowSolanaFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'escrow' as const;

  /**
   * @param signer - Facilitator signer for signature verification and TX execution
   * @param programId - SweeFi Escrow program ID for event anti-spoofing verification.
   *   Defaults to the devnet program ID. For mainnet, pass the mainnet program ID.
   */
  constructor(
    private readonly signer: FacilitatorSolanaSigner,
    private readonly programId: string = SWEEFI_ESCROW_PROGRAM_ID,
  ) {}

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'escrow') {
      return { valid: false, invalidReason: 'Expected escrow scheme' };
    }

    if (!isSolanaNetwork(requirements.network)) {
      return {
        valid: false,
        invalidReason: `Unsupported network: ${requirements.network}`,
      };
    }

    const escrowPayload = payload as s402EscrowPayload;
    const { transaction: serializedTx } = escrowPayload.payload;

    if (!serializedTx) {
      return { valid: false, invalidReason: 'Missing transaction in payload' };
    }

    // Verify escrow-specific requirements are present
    const reqEscrow = requirements.escrow;
    if (!reqEscrow) {
      return { valid: false, invalidReason: 'Requirements missing escrow config' };
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

      // Event-based verification: extract EscrowCreated event from logs
      if (!simResult.logs) {
        return {
          valid: false,
          invalidReason: 'Simulation returned no logs — cannot verify event',
          payerAddress,
        };
      }

      const escrowEvent = extractEscrowCreatedEvent(simResult.logs, this.programId);

      if (!escrowEvent) {
        return {
          valid: false,
          invalidReason: 'No EscrowCreated event found from expected program',
          payerAddress,
        };
      }

      // Verify buyer matches recovered signer (prevent impersonation)
      if (escrowEvent.buyer !== payerAddress) {
        return {
          valid: false,
          invalidReason: `Buyer mismatch: event=${escrowEvent.buyer}, signer=${payerAddress}`,
          payerAddress,
        };
      }

      // Verify seller matches requirements (prevent payment diversion)
      if (escrowEvent.seller !== reqEscrow.seller) {
        return {
          valid: false,
          invalidReason: `Seller mismatch: event=${escrowEvent.seller}, expected=${reqEscrow.seller}`,
          payerAddress,
        };
      }

      // Verify amount meets minimum
      const amount = escrowEvent.amount;
      const requiredAmount = BigInt(requirements.amount);
      if (amount < requiredAmount) {
        return {
          valid: false,
          invalidReason: `Amount ${amount} below required ${requiredAmount}`,
          payerAddress,
        };
      }

      // Verify deadline matches exactly (longer changes escrow economics).
      // Note: Solana uses Unix seconds (i64), s402 uses milliseconds.
      // Convert requirements.escrow.deadlineMs to seconds for comparison.
      const deadlineSec = BigInt(reqEscrow.deadlineMs) / 1000n;
      if (escrowEvent.deadline !== deadlineSec) {
        return {
          valid: false,
          invalidReason: `Deadline mismatch: event=${escrowEvent.deadline}s, required=${deadlineSec}s`,
          payerAddress,
        };
      }

      // Verify arbiter if specified in requirements
      if (reqEscrow.arbiter && escrowEvent.arbiter !== reqEscrow.arbiter) {
        return {
          valid: false,
          invalidReason: `Arbiter mismatch: event=${escrowEvent.arbiter}, required=${reqEscrow.arbiter}`,
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

    const escrowPayload = payload as s402EscrowPayload;
    // Type narrowed by isSolanaNetwork() guard above (verify) or validated by verify() (settle)
    const network = requirements.network as SolanaNetwork;

    try {
      const startMs = Date.now();

      const txSignature = await this.signer.executeTransaction(
        escrowPayload.payload.transaction,
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
