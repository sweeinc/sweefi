import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type {
  SweefiConfig,
  PrepaidDepositParams,
  PrepaidClaimParams,
  PrepaidOpParams,
  PrepaidTopUpParams,
  PrepaidDepositWithReceiptsParams,
  PrepaidFinalizeClaimParams,
  PrepaidDisputeClaimParams,
  PrepaidWithdrawDisputedParams,
} from "./types";
import type { Ed25519Verifier } from "../receipts";
import { SUI_CLOCK } from "./deployments";
import { assertFeeMicroPercent, assertPositive } from "./assert";

/** u64::MAX as string — use as max_calls for unlimited prepaid balances */
export const UNLIMITED_CALLS = "18446744073709551615";

/** Convert hex string (with optional 0x prefix) to number array for tx.pure */
function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2 !== 0) {
    throw new Error(
      `hexToBytes: hex string has odd length (${clean.length} chars). ` +
      "Each byte requires exactly 2 hex characters.",
    );
  }
  if (clean.length > 0 && !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("hexToBytes: hex string contains non-hex characters.");
  }
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return bytes;
}

function requireProtocolState(config: SweefiConfig, fn: string): string {
  if (!config.protocolStateId) {
    throw new Error(
      `${fn}: SweefiConfig.protocolStateId is required for prepaid deposit/top-up. ` +
      "Set it to the shared ProtocolState object ID from your deployment.",
    );
  }
  return config.protocolStateId;
}

/**
 * Build a PTB for an agent to deposit funds and create a PrepaidBalance.
 * The PrepaidBalance becomes a shared object — both agent and provider can interact.
 *
 * Trust model: The provider submits call counts. Move enforces rate caps and max_calls,
 * but cannot verify that API calls actually happened. The deposit amount is the agent's
 * maximum loss.
 */
export function buildDepositTx(
  config: SweefiConfig,
  params: PrepaidDepositParams,
): Transaction {
  assertPositive(params.amount, "amount", "buildDepositTx");
  assertPositive(params.ratePerCall, "ratePerCall", "buildDepositTx");
  assertFeeMicroPercent(params.feeMicroPercent, "buildDepositTx");

  const protocolStateId = requireProtocolState(config, "buildDepositTx");
  const tx = new Transaction();
  tx.setSender(params.sender);

  const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

  tx.moveCall({
    target: `${config.packageId}::prepaid::deposit`,
    typeArguments: [params.coinType],
    arguments: [
      coin,
      tx.pure.address(params.provider),
      tx.pure.u64(params.ratePerCall),
      tx.pure.u64(params.maxCalls ?? UNLIMITED_CALLS),
      tx.pure.u64(params.withdrawalDelayMs),
      tx.pure.u64(params.feeMicroPercent),
      tx.pure.address(params.feeRecipient),
      tx.object(protocolStateId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for a provider to claim earned funds based on cumulative call count.
 * Provider says "I've served N total calls". Move computes the delta and transfers
 * `delta * rate_per_call` (minus fees).
 *
 * Zero-delta claims (same count as last claim) are no-ops — safe for idempotent retries.
 * Claims are allowed during pending withdrawal (provider's grace period).
 */
export function buildClaimTx(
  config: SweefiConfig,
  params: PrepaidClaimParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::prepaid::claim`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.balanceId),
      tx.pure.u64(params.cumulativeCallCount),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the agent to request withdrawal of remaining funds.
 * Starts the grace period — provider can still claim during this time.
 * After withdrawal_delay_ms, agent calls buildFinalizeWithdrawalTx.
 */
export function buildRequestWithdrawalTx(
  config: SweefiConfig,
  params: PrepaidOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::prepaid::request_withdrawal`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.balanceId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the agent to finalize withdrawal after the grace period.
 * Destructures the PrepaidBalance, returning remaining funds to the agent.
 * Fails with EWithdrawalLocked if called before the delay has elapsed.
 */
export function buildFinalizeWithdrawalTx(
  config: SweefiConfig,
  params: PrepaidOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::prepaid::finalize_withdrawal`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.balanceId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the agent to cancel a pending withdrawal request.
 * Re-enables normal operation (top-up becomes possible again).
 */
export function buildCancelWithdrawalTx(
  config: SweefiConfig,
  params: PrepaidOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::prepaid::cancel_withdrawal`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.balanceId),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the agent to close an exhausted PrepaidBalance (0 remaining).
 * Destructures the shared object, returning the storage rebate.
 */
export function buildAgentCloseTx(
  config: SweefiConfig,
  params: PrepaidOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::prepaid::agent_close`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.balanceId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the provider to close a fully-claimed PrepaidBalance.
 * Destructures the shared object, returning the storage rebate.
 */
export function buildProviderCloseTx(
  config: SweefiConfig,
  params: PrepaidOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::prepaid::provider_close`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.balanceId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the agent to add more funds to an existing PrepaidBalance.
 * Blocked during pending withdrawal (would conflict with finalize).
 */
export function buildTopUpTx(
  config: SweefiConfig,
  params: PrepaidTopUpParams,
): Transaction {
  assertPositive(params.amount, "amount", "buildTopUpTx");
  const protocolStateId = requireProtocolState(config, "buildTopUpTx");
  const tx = new Transaction();
  tx.setSender(params.sender);

  const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

  tx.moveCall({
    target: `${config.packageId}::prepaid::top_up`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.balanceId),
      coin,
      tx.object(protocolStateId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

// ══════════════════════════════════════════════════════════════
// v0.2: Signed receipts / fraud proofs
// ══════════════════════════════════════════════════════════════

/**
 * Build a PTB for an agent to deposit funds with signed receipt support (v0.2).
 * The provider's Ed25519 public key is bound at deposit time. Claims on this
 * balance enter a pending state and can be disputed with fraud proofs.
 */
export function buildDepositWithReceiptsTx(
  config: SweefiConfig,
  params: PrepaidDepositWithReceiptsParams,
): Transaction {
  assertPositive(params.amount, "amount", "buildDepositWithReceiptsTx");
  assertPositive(params.ratePerCall, "ratePerCall", "buildDepositWithReceiptsTx");
  assertFeeMicroPercent(params.feeMicroPercent, "buildDepositWithReceiptsTx");

  const protocolStateId = requireProtocolState(config, "buildDepositWithReceiptsTx");
  const tx = new Transaction();
  tx.setSender(params.sender);

  const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

  tx.moveCall({
    target: `${config.packageId}::prepaid::deposit_with_receipts`,
    typeArguments: [params.coinType],
    arguments: [
      coin,
      tx.pure.address(params.provider),
      tx.pure.u64(params.ratePerCall),
      tx.pure.u64(params.maxCalls ?? UNLIMITED_CALLS),
      tx.pure.u64(params.withdrawalDelayMs),
      tx.pure.u64(params.feeMicroPercent),
      tx.pure.address(params.feeRecipient),
      tx.pure("vector<u8>", hexToBytes(params.providerPubkey)),
      tx.pure.u64(params.disputeWindowMs),
      tx.object(protocolStateId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB to finalize a pending claim after the dispute window.
 * Permissionless — anyone can call to prevent provider griefing.
 */
export function buildFinalizeClaimTx(
  config: SweefiConfig,
  params: PrepaidFinalizeClaimParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::prepaid::finalize_claim`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.balanceId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the agent to dispute a pending claim with a signed receipt.
 * The receipt proves the provider's claim count is fraudulent.
 */
export function buildDisputeClaimTx(
  config: SweefiConfig,
  params: PrepaidDisputeClaimParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::prepaid::dispute_claim`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.balanceId),
      tx.pure.address(params.receiptBalanceId),
      tx.pure.u64(params.receiptCallNumber),
      tx.pure.u64(params.receiptTimestampMs),
      tx.pure("vector<u8>", Array.from(params.receiptResponseHash)),
      tx.pure("vector<u8>", Array.from(params.signature)),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the agent to withdraw all funds from a disputed balance.
 * Immediate — no delay. Trust is broken, agent recovers everything.
 */
export function buildWithdrawDisputedTx(
  config: SweefiConfig,
  params: PrepaidWithdrawDisputedParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::prepaid::withdraw_disputed`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.balanceId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

// ══════════════════════════════════════════════════════════════
// Utility helpers
// ══════════════════════════════════════════════════════════════

/** Convert a Uint8Array to a hex string (no 0x prefix). Inverse of hexToBytes. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ══════════════════════════════════════════════════════════════
// Provider key verification (L2 mitigation)
// ══════════════════════════════════════════════════════════════

/**
 * Verify that a provider controls the Ed25519 key they advertise.
 *
 * Mitigates L2 (no on-chain pubkey ownership proof): before depositing with
 * `buildDepositWithReceiptsTx`, the agent sends a random nonce to the provider
 * and verifies the signed response against the advertised public key.
 *
 * Protocol:
 *   1. Agent generates a 32-byte random nonce
 *   2. POST nonce to `${providerUrl}/.well-known/s402-key-proof`
 *   3. Provider signs the nonce with their Ed25519 key and returns the signature
 *   4. Agent verifies signature against the advertised pubkey
 *
 * @param providerUrl - Base URL of the provider (e.g. "https://api.example.com")
 * @param advertisedPubkey - The Ed25519 public key the provider claims to own (32 bytes)
 * @param verify - Pluggable Ed25519 verifier (same type as receipts.ts)
 * @returns true if the provider proved key ownership
 */
export async function verifyProviderKey(
  providerUrl: string,
  advertisedPubkey: Uint8Array,
  verify: Ed25519Verifier,
): Promise<boolean> {
  // Challenge = nonce || pubkey — binding the key into the challenge prevents
  // a provider from proving key A while the agent deposits with key B.
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const challenge = new Uint8Array(nonce.length + advertisedPubkey.length);
  challenge.set(nonce, 0);
  challenge.set(advertisedPubkey, nonce.length);

  const url = `${providerUrl.replace(/\/+$/, "")}/.well-known/s402-key-proof`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: challenge,
  });

  if (!res.ok) return false;

  const signature = new Uint8Array(await res.arrayBuffer());
  if (signature.length !== 64) return false;

  return verify(challenge, signature);
}
