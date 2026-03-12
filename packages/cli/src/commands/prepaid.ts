/**
 * sweefi prepaid deposit <provider> <amount> [--coin SUI|USDC] [--rate <base-units-per-call>] [--max-calls <n>]
 * sweefi prepaid status [balance-id]
 *
 * Prepaid balances are SweeFi's killer feature: deposit once, consume many API calls.
 * Reduces 1,000 API calls from 1,000 on-chain TXs to just 2.
 */

import { Transaction } from "@mysten/sui/transactions";
import { PrepaidContract, createBuilderConfig } from "@sweefi/sui";
import type { CliContext } from "../context.js";
import { requireSigner, CliError, debug, withTimeout } from "../context.js";
import { outputSuccess, formatBalance, explorerUrl, computeGas, gasUsedSui } from "../output.js";
import type { RequestContext } from "../output.js";
import { resolveCoinType, parseAmount, validateAddress, validateObjectId, parseBigIntFlag, assertTxSuccess } from "../parse.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";
const UNLIMITED_CALLS = "18446744073709551615";
const DEFAULT_WITHDRAWAL_DELAY_MS = 86_400_000n; // 1 day

export async function prepaidDeposit(
  ctx: CliContext,
  args: string[],
  flags: { coin?: string; rate?: string; maxCalls?: string; dryRun?: boolean; human?: boolean },
  reqCtx: RequestContext,
): Promise<void> {
  if (args.length < 2) {
    throw new CliError("MISSING_ARGS", "Usage: sweefi prepaid deposit <provider> <amount>", false, "Example: sweefi prepaid deposit 0xProvider... 10 --coin SUI --rate 10000");
  }

  const signer = requireSigner(ctx);
  const provider = validateAddress(args[0], "Provider");
  const coinType = resolveCoinType(flags.coin, ctx.network);
  const amount = parseAmount(args[1], coinType);
  const ratePerCall = flags.rate ? parseBigIntFlag(flags.rate, "rate", { min: 1n }) : parseAmount("0.01", coinType); // default: 0.01 of coin
  const maxCalls = flags.maxCalls ? parseBigIntFlag(flags.maxCalls, "max-calls", { min: 1n }) : BigInt(UNLIMITED_CALLS);

  const prepaid = new PrepaidContract(createBuilderConfig({
    packageId: ctx.config.packageId,
    protocolState: ctx.config.protocolStateId,
  }));
  const tx = new Transaction();
  prepaid.deposit({
    coinType,
    sender: signer.toSuiAddress(),
    provider,
    amount,
    ratePerCall,
    maxCalls,
    withdrawalDelayMs: DEFAULT_WITHDRAWAL_DELAY_MS,
    feeMicroPercent: 0,
    feeRecipient: ZERO_ADDRESS,
  })(tx);

  if (flags.dryRun) {
    debug(ctx, "dry-run: inspecting prepaid deposit");
    const inspection = await withTimeout(ctx, ctx.suiClient.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: signer.toSuiAddress(),
    }), "devInspectTransactionBlock");
    const gas = computeGas(inspection);
    outputSuccess("prepaid deposit", {
      dryRun: true,
      status: inspection.effects?.status?.status ?? "unknown",
      gasEstimate: gasUsedSui(inspection),
      provider,
      amount: amount.toString(),
      amountFormatted: formatBalance(amount, coinType),
      ratePerCall: ratePerCall.toString(),
      maxCalls: maxCalls === BigInt(UNLIMITED_CALLS) ? "unlimited" : maxCalls.toString(),
      network: ctx.network,
    }, flags.human ?? false, reqCtx, gas);
    return;
  }

  debug(ctx, "signing and executing prepaid deposit");
  const result = await withTimeout(ctx, ctx.suiClient.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  }), "signAndExecuteTransaction");
  assertTxSuccess(result);

  const balanceObj = result.objectChanges?.find(
    (c: { type: string; objectType?: string }) => c.type === "created" && c.objectType?.includes("PrepaidBalance"),
  );
  const balanceId = balanceObj && "objectId" in balanceObj ? (balanceObj as { objectId: string }).objectId : undefined;

  const effectiveMaxCalls = maxCalls === BigInt(UNLIMITED_CALLS) ? "unlimited" : maxCalls.toString();
  const effectiveCostPerCall = ratePerCall > 0n ? formatBalance(ratePerCall, coinType) : "0";
  const gas = computeGas(result);

  outputSuccess("prepaid deposit", {
    txDigest: result.digest,
    balanceId,
    provider,
    amount: amount.toString(),
    amountFormatted: formatBalance(amount, coinType),
    ratePerCall: ratePerCall.toString(),
    maxCalls: effectiveMaxCalls,
    effectiveCostPerCall,
    gasCostSui: gasUsedSui(result),
    network: ctx.network,
    explorerUrl: explorerUrl(ctx.network, result.digest),
    timestampMs: Date.now(),
  }, flags.human ?? false, reqCtx, gas);
}

export async function prepaidStatus(ctx: CliContext, args: string[], flags: { human?: boolean }, reqCtx: RequestContext): Promise<void> {
  if (args.length < 1) {
    throw new CliError("MISSING_ARGS", "Usage: sweefi prepaid status <balance-id>", false, "Pass the PrepaidBalance object ID");
  }

  const balanceId = validateObjectId(args[0], "Balance ID");
  const result = await withTimeout(ctx, ctx.suiClient.getObject({
    id: balanceId,
    options: { showContent: true, showType: true },
  }), "getObject");

  if (result.error) {
    throw new CliError("OBJECT_NOT_FOUND", `PrepaidBalance ${balanceId} not found: ${result.error.code}`, false, "Check the object ID and network");
  }

  const content = result.data?.content;
  const fields = content?.dataType === "moveObject" ? (content.fields as Record<string, unknown>) : {};

  outputSuccess("prepaid status", {
    balanceId,
    ...fields,
    network: ctx.network,
  }, flags.human ?? false, reqCtx);
}

export async function prepaidList(ctx: CliContext, args: string[], flags: { human?: boolean }, reqCtx: RequestContext): Promise<void> {
  let address: string;
  if (args.length > 0 && args[0] && !args[0].startsWith("-")) {
    address = validateAddress(args[0], "Address");
  } else if (ctx.signer) {
    address = ctx.signer.toSuiAddress();
  } else {
    throw new CliError("NO_ADDRESS", "No address provided and no wallet configured", false, "Pass an address argument or set SUI_PRIVATE_KEY");
  }

  const typePrefix = `${ctx.config.packageId}::prepaid::PrepaidBalance`;
  const items: Array<{ objectId: string; type: string; fields: Record<string, unknown> }> = [];
  const MAX_PAGES = 20;
  let cursor: string | null | undefined = undefined;
  let hasNext = true;
  let pageCount = 0;

  while (hasNext && pageCount < MAX_PAGES) {
    pageCount++;
    const rpcCall = ctx.suiClient.getOwnedObjects({
      owner: address,
      filter: { MatchAll: [{ StructType: typePrefix }] },
      options: { showContent: true, showType: true },
      cursor: cursor ?? undefined,
    });
    const page = await withTimeout(ctx, rpcCall, "getOwnedObjects");

    for (const obj of page.data) {
      if (obj.data?.content?.dataType === "moveObject") {
        items.push({
          objectId: obj.data.objectId,
          type: obj.data.type ?? "unknown",
          fields: obj.data.content.fields as Record<string, unknown>,
        });
      }
    }

    hasNext = page.hasNextPage;
    cursor = page.nextCursor;
  }

  outputSuccess("prepaid list", {
    address,
    count: items.length,
    balances: items,
    ...(pageCount >= MAX_PAGES && hasNext && { truncated: true }),
    ...(items.length === 0 && { message: "No prepaid balances found. Create one with: sweefi prepaid deposit <provider> <amount>" }),
    network: ctx.network,
  }, flags.human ?? false, reqCtx);
}
