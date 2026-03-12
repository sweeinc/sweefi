/**
 * sweefi pay <recipient> <amount> [--coin SUI|USDC] [--memo "text"] [--mandate <id> --registry <id>] [--dry-run] [--idempotency-key <uuid>]
 *
 * One-shot direct payment on Sui. Returns tx digest, receipt ID, and gas cost.
 *
 * v0.2 additions:
 *   - --idempotency-key: crash-safe dedup via on-chain memo (REQUIRED in JSON mode)
 *   - --dry-run: now includes affordability check (balance vs total cost)
 */

import { Transaction } from "@mysten/sui/transactions";
import { PaymentContract, MandateContract, createBuilderConfig, COIN_TYPES } from "@sweefi/sui";
import type { CliContext } from "../context.js";
import { requireSigner, CliError, debug, withTimeout } from "../context.js";
import { outputSuccess, formatBalance, explorerUrl, computeGas, gasUsedSui } from "../output.js";
import type { RequestContext } from "../output.js";
import { resolveCoinType, parseAmount, validateAddress, validateObjectId, assertTxSuccess } from "../parse.js";
import { checkIdempotencyKey, buildIdempotencyMemo } from "../idempotency.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function pay(
  ctx: CliContext,
  args: string[],
  flags: {
    coin?: string;
    memo?: string;
    mandate?: string;
    registry?: string;
    dryRun?: boolean;
    human?: boolean;
    idempotencyKey?: string;
  },
  reqCtx: RequestContext,
): Promise<void> {
  if (args.length < 2) {
    throw new CliError("MISSING_ARGS", "Usage: sweefi pay <recipient> <amount>", false, "Example: sweefi pay 0xBob... 1.5 --coin SUI");
  }

  // Require idempotency key in JSON mode (non-human)
  if (!flags.human && !flags.idempotencyKey && !flags.dryRun) {
    throw new CliError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Payments in JSON mode require --idempotency-key to prevent double-spend on crash/retry",
      false,
      "Add --idempotency-key <UUID>. Example: sweefi pay 0xBob... 1.5 --idempotency-key $(uuidgen)",
      false,
    );
  }

  const signer = requireSigner(ctx);
  const recipient = validateAddress(args[0], "Recipient");
  const coinType = resolveCoinType(flags.coin, ctx.network);
  const amount = parseAmount(args[1], coinType);

  debug(ctx, "pay:", recipient, amount.toString(), "coin:", coinType, flags.idempotencyKey ? `idempotency:${flags.idempotencyKey}` : "");

  // Idempotency check: look for existing receipt with this key
  if (flags.idempotencyKey) {
    debug(ctx, "checking idempotency key:", flags.idempotencyKey);
    const existing = await checkIdempotencyKey(
      ctx.suiClient,
      signer.toSuiAddress(),
      ctx.config.packageId,
      flags.idempotencyKey,
      recipient,
      amount,
    );

    if (existing) {
      outputSuccess("pay", {
        idempotent: true,
        receiptId: existing.receiptId,
        txDigest: existing.txDigest,
        recipient,
        amount: amount.toString(),
        amountFormatted: formatBalance(amount, coinType),
        coin: coinType,
        message: "Payment already exists with this idempotency key — no new transaction created",
        network: ctx.network,
      }, flags.human ?? false, reqCtx);
      return;
    }
  }

  // Branch: mandated payment vs direct payment
  const mandateId = flags.mandate ? validateObjectId(flags.mandate, "Mandate ID") : undefined;
  const registryId = flags.registry ? validateObjectId(flags.registry, "Registry ID") : undefined;

  if (mandateId && !registryId) {
    throw new CliError("MISSING_ARGS", "--registry is required when using --mandate", false, "Example: sweefi pay 0xBob... 1.5 --mandate 0xMandate... --registry 0xRegistry...");
  }

  // Build memo: merge user memo + idempotency key
  const memo = flags.idempotencyKey
    ? buildIdempotencyMemo(flags.idempotencyKey, flags.memo)
    : flags.memo;

  const baseParams = {
    coinType,
    sender: signer.toSuiAddress(),
    recipient,
    amount,
    feeMicroPercent: 0,
    feeRecipient: ZERO_ADDRESS,
    memo,
  };

  const builderConfig = createBuilderConfig({
    packageId: ctx.config.packageId,
    protocolState: ctx.config.protocolStateId,
  });
  const tx = new Transaction();
  if (mandateId) {
    const mandate = new MandateContract(builderConfig);
    mandate.mandatedPay({ ...baseParams, mandateId, registryId: registryId! })(tx);
  } else {
    const payment = new PaymentContract(builderConfig);
    payment.pay(baseParams)(tx);
  }

  if (flags.dryRun) {
    const isSui = coinType === COIN_TYPES.SUI || coinType.endsWith("::sui::SUI");
    const senderAddress = signer.toSuiAddress();

    // Query payment coin balance (and SUI gas balance separately if paying with non-SUI)
    const queries: Promise<unknown>[] = [
      ctx.suiClient.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: senderAddress,
      }),
      ctx.suiClient.getBalance({ owner: senderAddress, coinType }),
    ];
    if (!isSui) {
      queries.push(ctx.suiClient.getBalance({ owner: senderAddress, coinType: COIN_TYPES.SUI }));
    }

    debug(ctx, "dry-run: inspecting transaction + checking balances");
    const results = await withTimeout(ctx, Promise.all(queries), "dry-run inspection");
    const inspection = results[0] as { effects?: { status?: { status: string }; gasUsed?: { computationCost: string; storageCost: string; storageRebate: string } } | null };
    const paymentBalance = results[1] as { totalBalance: string };
    const gasBalance = isSui ? paymentBalance : (results[2] as { totalBalance: string });

    const estimatedGas = computeGas(inspection);
    const estimatedGasMist = BigInt(estimatedGas?.mist ?? 0);
    const paymentBalanceBig = BigInt(paymentBalance.totalBalance);
    const gasBalanceBig = BigInt(gasBalance.totalBalance);

    // For SUI: single check (amount + gas vs SUI balance)
    // For non-SUI: two checks (amount vs coin balance, gas vs SUI balance)
    let affordable: boolean;
    let shortfall: Record<string, string> | null = null;

    if (isSui) {
      const totalCost = amount + estimatedGasMist;
      affordable = paymentBalanceBig >= totalCost;
      if (!affordable) {
        shortfall = { SUI: formatBalance(totalCost - paymentBalanceBig, COIN_TYPES.SUI) };
      }
    } else {
      const paymentAffordable = paymentBalanceBig >= amount;
      const gasAffordable = gasBalanceBig >= estimatedGasMist;
      affordable = paymentAffordable && gasAffordable;
      if (!affordable) {
        shortfall = {};
        if (!paymentAffordable) shortfall.payment = formatBalance(amount - paymentBalanceBig, coinType);
        if (!gasAffordable) shortfall.gas = formatBalance(estimatedGasMist - gasBalanceBig, COIN_TYPES.SUI);
      }
    }

    outputSuccess("pay", {
      dryRun: true,
      recipient,
      amount: amount.toString(),
      amountFormatted: formatBalance(amount, coinType),
      coin: coinType,
      ...(mandateId && { mandateId }),
      estimatedGasMist: Number(estimatedGasMist),
      affordable,
      currentBalance: {
        payment: formatBalance(paymentBalanceBig, coinType),
        ...(isSui ? {} : { gas: formatBalance(gasBalanceBig, COIN_TYPES.SUI) }),
      },
      shortfall,
      network: ctx.network,
    }, flags.human ?? false, reqCtx, estimatedGas);
    return;
  }

  debug(ctx, "signing and executing transaction");
  const result = await withTimeout(ctx, ctx.suiClient.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  }), "signAndExecuteTransaction");
  assertTxSuccess(result);
  debug(ctx, "tx confirmed:", result.digest);

  const receiptObj = result.objectChanges?.find(
    (c) => c.type === "created" && "objectType" in c && c.objectType?.includes("PaymentReceipt"),
  );
  const receiptId = receiptObj && "objectId" in receiptObj ? receiptObj.objectId : undefined;
  const gas = computeGas(result);

  outputSuccess("pay", {
    txDigest: result.digest,
    recipient,
    amount: amount.toString(),
    amountFormatted: formatBalance(amount, coinType),
    coin: coinType,
    ...(mandateId && { mandateId }),
    ...(flags.idempotencyKey && { idempotencyKey: flags.idempotencyKey }),
    receiptId,
    gasCostSui: gasUsedSui(result),
    network: ctx.network,
    explorerUrl: explorerUrl(ctx.network, result.digest),
    timestampMs: Date.now(),
  }, flags.human ?? false, reqCtx, gas);
}
