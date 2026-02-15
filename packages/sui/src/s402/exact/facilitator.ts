/**
 * s402 Exact Scheme — Facilitator
 *
 * Verifies and settles exact payment transactions.
 * Reuses the existing 4-step verification logic from the x402 facilitator:
 *   1. Scheme validation
 *   2. Network match
 *   3. Signature recovery + dry-run simulation
 *   4. Balance change verification
 *
 * Enhanced: settle() calls waitForTransaction() for finality confirmation.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402ExactPayload,
} from 's402';
import type { FacilitatorSuiSigner } from '../../signer.js';
import { coinTypesEqual } from '../../utils.js';

export class ExactSuiFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'exact' as const;

  constructor(private readonly signer: FacilitatorSuiSigner) {}

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'exact') {
      return { valid: false, invalidReason: 'Expected exact scheme' };
    }

    const exactPayload = payload as s402ExactPayload;
    const { transaction, signature } = exactPayload.payload;

    if (!transaction || !signature) {
      return { valid: false, invalidReason: 'Missing transaction or signature' };
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

      // Verify balance changes
      const balanceChanges = dryRunResult.balanceChanges ?? [];
      const recipientChange = balanceChanges.find(
        bc =>
          extractAddress(bc.owner) === requirements.payTo &&
          coinTypesEqual(bc.coinType, requirements.asset),
      );

      if (!recipientChange) {
        return { valid: false, invalidReason: 'Recipient did not receive expected coin type', payerAddress };
      }

      if (BigInt(recipientChange.amount) < BigInt(requirements.amount)) {
        return { valid: false, invalidReason: 'Amount insufficient', payerAddress };
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
    // Defense-in-depth: re-verify
    const verification = await this.verify(payload, requirements);
    if (!verification.valid) {
      return { success: false, error: verification.invalidReason };
    }

    const exactPayload = payload as s402ExactPayload;

    try {
      const startMs = Date.now();

      // Execute on-chain
      const txDigest = await this.signer.executeTransaction(
        exactPayload.payload.transaction,
        exactPayload.payload.signature,
        requirements.network,
      );

      // Wait for finality (hardened per expert review)
      await this.signer.waitForTransaction(txDigest, requirements.network);

      const finalityMs = Date.now() - startMs;

      return {
        success: true,
        txDigest,
        finalityMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Settlement failed',
      };
    }
  }
}

function extractAddress(owner: unknown): string {
  if (typeof owner === 'string') return '';
  if (owner && typeof owner === 'object' && 'AddressOwner' in owner) {
    return (owner as { AddressOwner: string }).AddressOwner;
  }
  return '';
}
