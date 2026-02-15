import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SweepayConfig, PrepaidDepositParams, PrepaidClaimParams, PrepaidOpParams, PrepaidTopUpParams } from "./types";
import { SUI_CLOCK } from "./deployments";
import { assertFeeBps, assertPositive } from "./assert";

/** u64::MAX as string — use as max_calls for unlimited prepaid balances */
export const UNLIMITED_CALLS = "18446744073709551615";

function requireProtocolState(config: SweepayConfig, fn: string): string {
  if (!config.protocolStateId) {
    throw new Error(
      `${fn}: SweepayConfig.protocolStateId is required for prepaid deposit/top-up. ` +
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
  config: SweepayConfig,
  params: PrepaidDepositParams,
): Transaction {
  assertPositive(params.amount, "amount", "buildDepositTx");
  assertPositive(params.ratePerCall, "ratePerCall", "buildDepositTx");
  assertFeeBps(params.feeBps, "buildDepositTx");

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
      tx.pure.u64(params.feeBps),
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
  config: SweepayConfig,
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
  config: SweepayConfig,
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
  config: SweepayConfig,
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
  config: SweepayConfig,
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
  config: SweepayConfig,
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
  config: SweepayConfig,
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
  config: SweepayConfig,
  params: PrepaidTopUpParams,
): Transaction {
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
