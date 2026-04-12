/**
 * Shared digest-binding verification for all client-signed Sui schemes.
 *
 * Sui tx digest = base58(blake2b_256("TransactionData::" || bcs_bytes)).
 * This is a pure function of the BCS-encoded bytes — identical regardless of
 * what the PTB contains (transfer, Move call, shared-object mutation, etc.).
 *
 * See s402 INVARIANTS.md § S8 for the cryptographic proof.
 */

import { TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import type {
  s402PaymentPayload,
  s402SettleResponse,
  s402SettlementVerification,
} from 's402';

/**
 * Verify that a facilitator's SettleResponse digest matches the transaction
 * the client actually signed. Pure, offline, no RPC call.
 *
 * @param expectedScheme - The scheme name to guard against misrouted calls
 * @param payload - The payment payload the client created and signed
 * @param settleResponse - The facilitator's settlement response
 */
export function verifySuiSettlement(
  expectedScheme: string,
  payload: s402PaymentPayload,
  settleResponse: s402SettleResponse,
): s402SettlementVerification {
  if (payload.scheme !== expectedScheme) {
    return {
      verified: false,
      expectedDigest: '',
      actualDigest: settleResponse.txDigest ?? null,
      reason: `verifySettlement called with non-${expectedScheme} scheme "${payload.scheme}"`,
    };
  }

  let signedBytes: Uint8Array;
  try {
    signedBytes = fromBase64(payload.payload.transaction);
  } catch {
    return {
      verified: false,
      expectedDigest: '',
      actualDigest: settleResponse.txDigest ?? null,
      reason: 'Failed to decode transaction bytes — payload may be malformed',
    };
  }

  const expectedDigest = TransactionDataBuilder.getDigestFromBytes(signedBytes);

  const actualDigest = settleResponse.txDigest ?? null;
  if (!actualDigest) {
    return {
      verified: false,
      expectedDigest,
      actualDigest: null,
      reason: 'SettleResponse did not include a txDigest — cannot verify',
    };
  }

  if (actualDigest !== expectedDigest) {
    return {
      verified: false,
      expectedDigest,
      actualDigest,
      reason:
        `Digest mismatch: facilitator returned ${actualDigest} but the ` +
        `signed payload commits to ${expectedDigest}. The facilitator ` +
        `broadcast a different transaction, or is lying about what it ` +
        `broadcast. Treat this payment as non-settled and do NOT retry.`,
    };
  }

  return { verified: true, expectedDigest, actualDigest };
}
