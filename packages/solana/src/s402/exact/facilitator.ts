/**
 * s402 Exact Scheme — Facilitator (Solana)
 *
 * Verifies and settles exact payment transactions.
 * 5-step verification logic:
 *   1. Scheme validation (is this an 'exact' payload?)
 *   2. Network validation (is this actually a Solana network?)
 *   3. Signature recovery — cryptographic proof payer signed the transaction
 *   4. Simulation — would this transaction succeed if submitted?
 *   5. Balance verification — did the recipient receive the required amount?
 *
 * Unlike prepaid/stream/escrow/upto (which use event-based verification),
 * the exact scheme verifies balance changes directly from simulation results.
 */

import type {
  s402FacilitatorScheme,
  s402PaymentPayload,
  s402PaymentRequirements,
  s402VerifyResponse,
  s402SettleResponse,
  s402ExactPayload,
} from 's402';
import type { FacilitatorSolanaSigner, SolanaSimulateResult } from '../../signer.js';
import type { SolanaNetwork } from '../../constants.js';
import { NATIVE_SOL_MINT, isSolanaNetwork } from '../../constants.js';

// ─── ExactSolanaFacilitatorScheme ─────────────────────────────────────────────

export class ExactSolanaFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'exact' as const;

  constructor(private readonly signer: FacilitatorSolanaSigner) {}

  async verify(
    payload: s402PaymentPayload,
    requirements: s402PaymentRequirements,
  ): Promise<s402VerifyResponse> {
    if (payload.scheme !== 'exact') {
      return { valid: false, invalidReason: 'Expected exact scheme' };
    }

    // Guard: reject non-Solana requirements before any parsing attempt.
    // Without this, a misrouted Ethereum payment object would pass the type cast
    // and cause confusing errors inside verifyAndGetPayer or simulateTransaction.
    // The type guard narrows requirements.network to SolanaNetwork for later use.
    if (!isSolanaNetwork(requirements.network)) {
      return {
        valid: false,
        invalidReason: `Unsupported network for Solana facilitator: ${requirements.network} (expected solana:mainnet-beta, solana:devnet, or solana:testnet)`,
      };
    }

    const exactPayload = payload as s402ExactPayload;
    const { transaction: serializedTx } = exactPayload.payload;

    if (!serializedTx) {
      return { valid: false, invalidReason: 'Missing transaction in payload' };
    }

    // Type is narrowed by isSolanaNetwork() guard above
    const network = requirements.network;

    try {
      // Step 1: Cryptographically verify the payer's signature and extract their address
      const payerAddress = await this.signer.verifyAndGetPayer(serializedTx, network);

      // Step 2: Simulate — ensures the transaction would succeed on-chain
      const simResult = await this.signer.simulateTransaction(serializedTx, network);

      if (!simResult.success) {
        return {
          valid: false,
          invalidReason: `Simulation failed: ${JSON.stringify(simResult.err)}`,
          payerAddress,
        };
      }

      // Step 3: Verify the recipient received the required amount
      const isNative = requirements.asset === NATIVE_SOL_MINT || requirements.asset === 'native';

      if (isNative) {
        const solResult = verifySolTransfer(simResult, requirements);
        if (!solResult.success) {
          const reason = solResult.reason
            ?? `SOL balance delta ${solResult.actual} below required ${solResult.required}`;
          return { valid: false, invalidReason: reason, payerAddress };
        }
      } else {
        const splResult = verifySplTransfer(simResult, requirements);
        if (!splResult.success) {
          const reason = splResult.reason
            ?? `SPL token balance delta ${splResult.actual} below required ${splResult.required}`;
          return { valid: false, invalidReason: reason, payerAddress };
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
    // Defense-in-depth: re-verify before submitting (mirrors ExactSuiFacilitatorScheme)
    const verification = await this.verify(payload, requirements);
    if (!verification.valid) {
      return { success: false, error: verification.invalidReason };
    }

    const exactPayload = payload as s402ExactPayload;
    // Safe cast: verify() validated network and would have returned early on failure
    const network = requirements.network as SolanaNetwork;

    try {
      const startMs = Date.now();

      const txSignature = await this.signer.executeTransaction(
        exactPayload.payload.transaction,
        network,
      );

      await this.signer.confirmTransaction(txSignature, network);

      const finalityMs = Date.now() - startMs;

      return {
        success: true,
        txDigest: txSignature,
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

// ─── Balance verification helpers ─────────────────────────────────────────────

/**
 * Verify that the recipient's native SOL balance increased by at least
 * `requirements.amount` lamports in the simulation.
 *
 * Uses sim.accountKeys to map the account index back to the recipient's address,
 * then compares preBalances[i] vs postBalances[i].
 */
interface BalanceVerificationResult {
  success: boolean;
  actual?: bigint;
  required?: bigint;
  reason?: string;
}

function verifySolTransfer(
  sim: SolanaSimulateResult,
  requirements: s402PaymentRequirements,
): BalanceVerificationResult {
  const required = BigInt(requirements.amount);
  const recipientIndex = sim.accountKeys.indexOf(requirements.payTo);

  if (recipientIndex === -1) {
    return { success: false, reason: 'Recipient not in transaction account list' };
  }

  // Guard against undefined balance arrays (defensive — RPC should always provide these)
  if (!sim.preBalances || !sim.postBalances) {
    return { success: false, reason: 'Simulation missing balance data' };
  }

  const pre = BigInt(sim.preBalances[recipientIndex] ?? 0);
  const post = BigInt(sim.postBalances[recipientIndex] ?? 0);
  const delta = post - pre;

  if (delta >= required) {
    return { success: true, actual: delta, required };
  }
  return { success: false, actual: delta, required };
}

/**
 * Verify that the recipient received at least `requirements.amount` of the
 * required SPL token (`requirements.asset`) in the simulation.
 *
 * Matching strategy:
 *   - Filter postTokenBalances by mint === requirements.asset
 *   - The `owner` field identifies the wallet address that owns each token account.
 *     If `owner` is absent (older RPC nodes), the entry is REJECTED conservatively —
 *     accepting an unknown ATA as the recipient would be a security hole.
 *   - Compare pre vs post balance for the matched entry; check delta >= required.
 *
 * Security note on owner === undefined:
 *   The guard `!post.owner || post.owner !== requirements.payTo` means:
 *   - owner is absent → skip (conservative: reject ambiguous proofs)
 *   - owner is present but wrong address → skip
 *   - owner is present and matches → proceed to balance delta check
 *   This prevents an attacker from exploiting missing owner metadata to pass off
 *   a transfer to the wrong ATA as valid.
 *
 * TODO (Danny): Implement the owner-absent fallback if you need support for older
 * RPC nodes. The approach: use `sim.accountKeys[post.accountIndex]` as the ATA
 * address and verify it is the canonical ATA for requirements.payTo + mint using
 * `getAssociatedTokenAddressSync(mint, recipientPubKey)`.
 */
function verifySplTransfer(
  sim: SolanaSimulateResult,
  requirements: s402PaymentRequirements,
): BalanceVerificationResult {
  const required = BigInt(requirements.amount);
  const postTokens = sim.postTokenBalances ?? [];
  const preTokens = sim.preTokenBalances ?? [];

  // Track highest delta found for better error messages
  let highestDelta = 0n;
  let foundMatchingMint = false;

  for (const post of postTokens) {
    if (post.mint !== requirements.asset) continue;
    foundMatchingMint = true;

    // Conservative guard: owner absent → skip; wrong owner → skip.
    // Do NOT use `post.owner !== undefined && post.owner !== requirements.payTo`
    // because that would fall through when owner is undefined, accepting any ATA.
    if (!post.owner || post.owner !== requirements.payTo) continue;

    const pre = preTokens.find(
      (p) => p.accountIndex === post.accountIndex && p.mint === post.mint,
    );
    const preAmount = BigInt(pre?.uiTokenAmount.amount ?? '0');
    const postAmount = BigInt(post.uiTokenAmount.amount);
    const delta = postAmount - preAmount;

    if (delta >= required) {
      return { success: true, actual: delta, required };
    }
    if (delta > highestDelta) {
      highestDelta = delta;
    }
  }

  // Provide specific failure reason
  if (!foundMatchingMint) {
    return { success: false, reason: 'No token balance changes for required mint' };
  }
  return { success: false, actual: highestDelta, required };
}
