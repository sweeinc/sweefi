import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SweefiConfig, CreateStreamParams, CreateStreamWithTimeoutParams, StreamOpParams, StreamTopUpParams, BatchClaimParams } from "./types";
import { SUI_CLOCK } from "./deployments";
import { assertFeeMicroPercent, assertPositive } from "./assert";

function requireProtocolState(config: SweefiConfig, fn: string): string {
  if (!config.protocolStateId) {
    throw new Error(
      `${fn}: SweefiConfig.protocolStateId is required for stream creation/top-up. ` +
      "Set it to the shared ProtocolState object ID from your deployment.",
    );
  }
  return config.protocolStateId;
}

/**
 * Build a PTB to create a streaming payment channel.
 * The StreamingMeter becomes a shared object — both payer and recipient can interact.
 * Accrual starts immediately at the specified rate.
 * Default recipient_close timeout: 7 days. Use buildCreateStreamWithTimeoutTx for custom.
 */
export function buildCreateStreamTx(
  config: SweefiConfig,
  params: CreateStreamParams,
): Transaction {
  assertPositive(params.depositAmount, "depositAmount", "buildCreateStreamTx");
  assertPositive(params.ratePerSecond, "ratePerSecond", "buildCreateStreamTx");
  assertFeeMicroPercent(params.feeMicroPercent, "buildCreateStreamTx");

  const protocolStateId = requireProtocolState(config, "buildCreateStreamTx");
  const tx = new Transaction();
  tx.setSender(params.sender);

  const deposit = coinWithBalance({ type: params.coinType, balance: params.depositAmount });

  tx.moveCall({
    target: `${config.packageId}::stream::create`,
    typeArguments: [params.coinType],
    arguments: [
      deposit,
      tx.pure.address(params.recipient),
      tx.pure.u64(params.ratePerSecond),
      tx.pure.u64(params.budgetCap),
      tx.pure.u64(params.feeMicroPercent),
      tx.pure.address(params.feeRecipient),
      tx.object(protocolStateId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB to create a streaming payment channel with custom recipient_close timeout.
 * Same as buildCreateStreamTx but with configurable timeout for abandoned stream recovery.
 * Stored as a Sui dynamic field — no struct change needed for backward compatibility.
 *
 * @param params.recipientCloseTimeoutMs - Minimum 86_400_000 (1 day). Contract enforces floor.
 */
export function buildCreateStreamWithTimeoutTx(
  config: SweefiConfig,
  params: CreateStreamWithTimeoutParams,
): Transaction {
  assertPositive(params.depositAmount, "depositAmount", "buildCreateStreamWithTimeoutTx");
  assertPositive(params.ratePerSecond, "ratePerSecond", "buildCreateStreamWithTimeoutTx");
  assertFeeMicroPercent(params.feeMicroPercent, "buildCreateStreamWithTimeoutTx");

  const protocolStateId = requireProtocolState(config, "buildCreateStreamWithTimeoutTx");
  const tx = new Transaction();
  tx.setSender(params.sender);

  const deposit = coinWithBalance({ type: params.coinType, balance: params.depositAmount });

  tx.moveCall({
    target: `${config.packageId}::stream::create_with_timeout`,
    typeArguments: [params.coinType],
    arguments: [
      deposit,
      tx.pure.address(params.recipient),
      tx.pure.u64(params.ratePerSecond),
      tx.pure.u64(params.budgetCap),
      tx.pure.u64(params.feeMicroPercent),
      tx.pure.address(params.feeRecipient),
      tx.pure.u64(params.recipientCloseTimeoutMs),
      tx.object(protocolStateId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the recipient to claim accrued funds from a stream.
 * Works for both active streams and paused streams with pending accrual.
 * Fees are split to fee_recipient automatically.
 */
export function buildClaimTx(
  config: SweefiConfig,
  params: StreamOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::stream::claim`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.meterId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the payer to pause a stream.
 * Accrual stops at the pause timestamp. Pre-pause accrual remains claimable.
 */
export function buildPauseTx(
  config: SweefiConfig,
  params: StreamOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::stream::pause`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.meterId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the payer to resume a paused stream.
 * Pre-pause accrual is preserved via time-shift pattern (v5 fix).
 * Accrual restarts from current timestamp with backward-shifted last_claim_ms.
 */
export function buildResumeTx(
  config: SweefiConfig,
  params: StreamOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::stream::resume`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.meterId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the payer to close a stream.
 * Final claim sent to recipient (including paused accrual), remainder refunded to payer.
 * The StreamingMeter object is consumed (deleted).
 */
export function buildCloseTx(
  config: SweefiConfig,
  params: StreamOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::stream::close`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.meterId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB for the recipient to close an abandoned stream.
 * Allows the recipient to recover funds when the payer disappears.
 * Final claim sent to recipient, remainder refunded to payer.
 * The StreamingMeter object is consumed (deleted).
 *
 * NOTE: This is the safety valve — prevents permanent fund lockup
 * when a payer loses keys or abandons the stream.
 */
export function buildRecipientCloseTx(
  config: SweefiConfig,
  params: StreamOpParams,
): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  tx.moveCall({
    target: `${config.packageId}::stream::recipient_close`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.meterId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}

/**
 * Build a PTB to claim from multiple streams in a single transaction.
 * Reduces gas overhead by 60-70% per stream vs individual claims.
 * All streams must use the same coin type.
 *
 * Economic context: At $0.0003/sec accrual and ~$0.005/claim gas,
 * batching 5 claims saves ~$0.015-0.020 in gas per batch.
 */
export function buildBatchClaimTx(
  config: SweefiConfig,
  params: BatchClaimParams,
): Transaction {
  if (params.meterIds.length === 0) {
    throw new Error("buildBatchClaimTx: meterIds must not be empty");
  }
  if (params.meterIds.length > 512) {
    throw new Error("buildBatchClaimTx: max 512 streams per batch (Sui PTB command limit)");
  }

  const tx = new Transaction();
  tx.setSender(params.sender);

  for (const meterId of params.meterIds) {
    tx.moveCall({
      target: `${config.packageId}::stream::claim`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(meterId),
        tx.object(SUI_CLOCK),
      ],
    });
  }

  return tx;
}

/**
 * Build a PTB for the payer to add more funds to an existing stream.
 */
export function buildTopUpTx(
  config: SweefiConfig,
  params: StreamTopUpParams,
): Transaction {
  assertPositive(params.depositAmount, "depositAmount", "buildTopUpTx");
  const protocolStateId = requireProtocolState(config, "buildTopUpTx");
  const tx = new Transaction();
  tx.setSender(params.sender);

  const deposit = coinWithBalance({ type: params.coinType, balance: params.depositAmount });

  tx.moveCall({
    target: `${config.packageId}::stream::top_up`,
    typeArguments: [params.coinType],
    arguments: [
      tx.object(params.meterId),
      deposit,
      tx.object(protocolStateId),
      tx.object(SUI_CLOCK),
    ],
  });

  return tx;
}
