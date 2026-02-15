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

      // Event-based verification: the PrepaidDeposited event emitted by the Move
      // contract is the authoritative source for deposit parameters. This is superior
      // to balance-change inspection because:
      //   1. Events contain the exact deposit amount (no gas fee confusion)
      //   2. Events contain the provider address (enables provider verification)
      //   3. Events are emitted by the contract itself (single source of truth)
      const depositEvent = extractDepositEvent(dryRunResult.events ?? []);

      if (!depositEvent) {
        return {
          valid: false,
          invalidReason: 'No PrepaidDeposited event found in simulation',
          payerAddress,
        };
      }

      // Verify deposit targets the correct provider (prevents free-service attack
      // where client sets provider=self, gets access, then claims back their deposit)
      if (depositEvent.provider !== requirements.payTo) {
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

      // Extract balanceId from the PrepaidDeposited event in the settled transaction.
      // Uses the optional getTransactionBlock method — if not available, the server
      // can query the transaction effects directly using the txDigest.
      let balanceId: string | undefined;
      if (this.signer.getTransactionBlock) {
        const txBlock = await this.signer.getTransactionBlock(txDigest, requirements.network);
        const depositEvent = extractDepositEvent(txBlock.events ?? []);
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
  token_type: string;
  timestamp_ms: string;
}

/**
 * Extract PrepaidDeposited event from dry-run or execution results.
 *
 * Uses event data instead of balance changes for verification because:
 *   1. Events contain the exact deposit amount (no gas fee confusion with coin type)
 *   2. Events contain the provider address (enables provider verification)
 *   3. Events are emitted by the Move contract itself (authoritative source)
 */
function extractDepositEvent(
  events: Array<{ type: string; parsedJson?: unknown }>,
): DepositEventData | null {
  const event = events.find(e => e.type.endsWith('::prepaid::PrepaidDeposited'));
  if (!event?.parsedJson || typeof event.parsedJson !== 'object') return null;
  return event.parsedJson as DepositEventData;
}
