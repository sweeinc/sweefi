/**
 * sweefi pay <recipient> <amount> [--coin SUI|USDC] [--memo "text"] [--mandate <id> --registry <id>] [--dry-run]
 *
 * One-shot direct payment on Sui. Returns tx digest, receipt ID, and gas cost.
 */

import { buildPayTx, buildMandatedPayTx } from "@sweefi/sui/ptb";
import type { CliContext } from "../context.js";
import { requireSigner, CliError } from "../context.js";
import { outputSuccess, formatBalance, explorerUrl } from "../output.js";
import { resolveCoinType, parseAmount, validateAddress, validateObjectId, assertTxSuccess, gasUsedSui } from "../parse.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function pay(ctx: CliContext, args: string[], flags: { coin?: string; memo?: string; mandate?: string; registry?: string; dryRun?: boolean; human?: boolean }): Promise<void> {
  if (args.length < 2) {
    throw new CliError("MISSING_ARGS", "Usage: sweefi pay <recipient> <amount>", false, "Example: sweefi pay 0xBob... 1.5 --coin SUI");
  }

  const signer = requireSigner(ctx);
  const recipient = validateAddress(args[0], "Recipient");
  const coinType = resolveCoinType(flags.coin, ctx.network);
  const amount = parseAmount(args[1], coinType);

  // Branch: mandated payment vs direct payment
  const mandateId = flags.mandate ? validateObjectId(flags.mandate, "Mandate ID") : undefined;
  const registryId = flags.registry ? validateObjectId(flags.registry, "Registry ID") : undefined;

  if (mandateId && !registryId) {
    throw new CliError("MISSING_ARGS", "--registry is required when using --mandate", false, "Example: sweefi pay 0xBob... 1.5 --mandate 0xMandate... --registry 0xRegistry...");
  }

  const baseParams = {
    coinType,
    sender: signer.toSuiAddress(),
    recipient,
    amount,
    feeMicroPercent: 0,
    feeRecipient: ZERO_ADDRESS,
    memo: flags.memo,
  };

  const tx = mandateId
    ? buildMandatedPayTx(ctx.config, { ...baseParams, mandateId, registryId: registryId! })
    : buildPayTx(ctx.config, baseParams);

  if (flags.dryRun) {
    const inspection = await ctx.suiClient.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: signer.toSuiAddress(),
    });
    outputSuccess("pay", {
      dryRun: true,
      status: inspection.effects?.status?.status ?? "unknown",
      gasEstimate: gasUsedSui(inspection),
      amount: amount.toString(),
      amountFormatted: formatBalance(amount, coinType),
      recipient,
      coin: coinType,
      ...(mandateId && { mandateId }),
      network: ctx.network,
    }, flags.human ?? false);
    return;
  }

  const result = await ctx.suiClient.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  assertTxSuccess(result);

  const receiptObj = result.objectChanges?.find(
    (c) => c.type === "created" && "objectType" in c && c.objectType?.includes("PaymentReceipt"),
  );
  const receiptId = receiptObj && "objectId" in receiptObj ? receiptObj.objectId : undefined;

  outputSuccess("pay", {
    txDigest: result.digest,
    recipient,
    amount: amount.toString(),
    amountFormatted: formatBalance(amount, coinType),
    coin: coinType,
    ...(mandateId && { mandateId }),
    receiptId,
    gasCostSui: gasUsedSui(result),
    network: ctx.network,
    explorerUrl: explorerUrl(ctx.network, result.digest),
    timestampMs: Date.now(),
  }, flags.human ?? false);
}
