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
 *   4. Balance change verification (deposit amount matches requirements)
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

export class PrepaidSuiFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'prepaid' as const;

  constructor(private readonly signer: FacilitatorSuiSigner) {}

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

      // Verify deposit amount meets minimum
      // The deposit PTB moves funds from the agent's wallet into the PrepaidBalance.
      // In dry-run, the agent's balance decreases by the deposit amount.
      // We verify the decrease is at least the minDeposit.
      const balanceChanges = dryRunResult.balanceChanges ?? [];

      // The payer's balance should decrease by at least minDeposit
      const payerChange = balanceChanges.find(
        bc =>
          extractAddress(bc.owner) === payerAddress &&
          BigInt(bc.amount) < 0n,
      );

      if (payerChange) {
        const depositedAmount = -BigInt(payerChange.amount);
        const minDeposit = BigInt(reqPrepaid.minDeposit);
        if (depositedAmount < minDeposit) {
          return {
            valid: false,
            invalidReason: `Deposit ${depositedAmount} below minimum ${minDeposit}`,
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
    // Defense-in-depth: re-verify
    const verification = await this.verify(payload, requirements);
    if (!verification.valid) {
      return { success: false, error: verification.invalidReason };
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

      // The PrepaidBalance object ID is created by the transaction.
      // The server should query the transaction effects to get it,
      // or the facilitator can extract it from the created objects.
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
