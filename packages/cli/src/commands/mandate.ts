/**
 * sweepay mandate create <agent-address> <max-per-tx> <max-total> <expires-in>
 * sweepay mandate check [mandate-id]
 *
 * Mandates are spending authorizations — the autonomy primitive that lets
 * agents operate economically independent within human-set caps.
 * No other payment skill has this.
 */

import { buildCreateMandateTx } from "@sweepay/sui/ptb";
import type { CliContext } from "../context.js";
import { requireSigner, CliError } from "../context.js";
import { outputSuccess, formatBalance, explorerUrl } from "../output.js";
import { resolveCoinType, parseAmount, parseDuration, validateAddress, validateObjectId, assertTxSuccess, gasUsedSui } from "../parse.js";

export async function mandateCreate(
  ctx: CliContext,
  args: string[],
  flags: { coin?: string; dryRun?: boolean; human?: boolean },
): Promise<void> {
  if (args.length < 4) {
    throw new CliError(
      "MISSING_ARGS",
      "Usage: sweepay mandate create <agent-address> <max-per-tx> <max-total> <expires-in>",
      false,
      'Example: sweepay mandate create 0xAgent... 1 50 7d',
    );
  }

  const signer = requireSigner(ctx);
  const delegate = validateAddress(args[0], "Agent address");
  const coinType = resolveCoinType(flags.coin, ctx.network);
  const maxPerTx = parseAmount(args[1], coinType);
  const maxTotal = parseAmount(args[2], coinType);
  if (maxPerTx > maxTotal) {
    throw new CliError("INVALID_MANDATE", `max-per-tx (${args[1]}) cannot exceed max-total (${args[2]})`, false, "Set max-per-tx <= max-total");
  }
  const durationMs = parseDuration(args[3]);
  const expiresAtMs = BigInt(Date.now()) + durationMs;

  const tx = buildCreateMandateTx(ctx.config, {
    coinType,
    sender: signer.toSuiAddress(),
    delegate,
    maxPerTx,
    maxTotal,
    expiresAtMs,
  });

  if (flags.dryRun) {
    const inspection = await ctx.suiClient.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: signer.toSuiAddress(),
    });
    outputSuccess("mandate create", {
      dryRun: true,
      status: inspection.effects?.status?.status ?? "unknown",
      gasEstimate: gasUsedSui(inspection),
      agent: delegate,
      maxPerTx: maxPerTx.toString(),
      maxPerTxFormatted: formatBalance(maxPerTx, coinType),
      maxTotal: maxTotal.toString(),
      maxTotalFormatted: formatBalance(maxTotal, coinType),
      expiresAt: new Date(Number(expiresAtMs)).toISOString(),
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

  const mandateObj = result.objectChanges?.find(
    (c: { type: string; objectType?: string }) => c.type === "created" && c.objectType?.includes("Mandate"),
  );
  const mandateId = mandateObj && "objectId" in mandateObj ? (mandateObj as { objectId: string }).objectId : undefined;

  outputSuccess("mandate create", {
    txDigest: result.digest,
    mandateId,
    agent: delegate,
    maxPerTx: maxPerTx.toString(),
    maxPerTxFormatted: formatBalance(maxPerTx, coinType),
    maxTotal: maxTotal.toString(),
    maxTotalFormatted: formatBalance(maxTotal, coinType),
    expiresAt: new Date(Number(expiresAtMs)).toISOString(),
    gasCostSui: gasUsedSui(result),
    network: ctx.network,
    explorerUrl: explorerUrl(ctx.network, result.digest),
    timestampMs: Date.now(),
  }, flags.human ?? false);
}

export async function mandateList(ctx: CliContext, args: string[], flags: { human?: boolean }): Promise<void> {
  let address: string;
  if (args.length > 0 && args[0] && !args[0].startsWith("-")) {
    address = validateAddress(args[0], "Address");
  } else if (ctx.signer) {
    address = ctx.signer.toSuiAddress();
  } else {
    throw new CliError("NO_ADDRESS", "No address provided and no wallet configured", false, "Pass an address argument or set SUI_PRIVATE_KEY");
  }

  const typePrefix = `${ctx.config.packageId}::mandate::Mandate`;
  const items: Array<{ objectId: string; type: string; fields: Record<string, unknown> }> = [];
  let cursor: string | null | undefined = undefined;
  let hasNext = true;

  while (hasNext) {
    const page = await ctx.suiClient.getOwnedObjects({
      owner: address,
      filter: { MatchAll: [{ StructType: typePrefix }] },
      options: { showContent: true, showType: true },
      cursor: cursor ?? undefined,
    });

    for (const obj of page.data) {
      if (obj.data?.content?.dataType === "moveObject") {
        const fields = obj.data.content.fields as Record<string, unknown>;
        const expiresAtMs = fields.expires_at_ms ?? fields.expiresAtMs;
        const expired = typeof expiresAtMs === "string" ? Date.now() > Number(expiresAtMs) : undefined;
        items.push({
          objectId: obj.data.objectId,
          type: obj.data.type ?? "unknown",
          fields: { ...fields, expired },
        });
      }
    }

    hasNext = page.hasNextPage;
    cursor = page.nextCursor;
  }

  outputSuccess("mandate list", {
    address,
    count: items.length,
    mandates: items,
    ...(items.length === 0 && { message: "No mandates found. A human delegator must create one with: sweepay mandate create <agent-address> <max-per-tx> <max-total> <expires-in>" }),
    network: ctx.network,
  }, flags.human ?? false);
}

export async function mandateCheck(ctx: CliContext, args: string[], flags: { human?: boolean }): Promise<void> {
  if (args.length < 1) {
    throw new CliError("MISSING_ARGS", "Usage: sweepay mandate check <mandate-id>", false, "Pass the Mandate object ID");
  }

  const mandateId = validateObjectId(args[0], "Mandate ID");
  const result = await ctx.suiClient.getObject({
    id: mandateId,
    options: { showContent: true, showType: true, showOwner: true },
  });

  if (result.error) {
    throw new CliError("OBJECT_NOT_FOUND", `Mandate ${mandateId} not found: ${result.error.code}`, false, "Check the object ID and network");
  }

  const content = result.data?.content;
  const fields = content?.dataType === "moveObject" ? (content.fields as Record<string, unknown>) : {};

  // Check expiry
  const expiresAtMs = fields.expires_at_ms ?? fields.expiresAtMs;
  const expired = typeof expiresAtMs === "string" ? Date.now() > Number(expiresAtMs) : undefined;

  outputSuccess("mandate check", {
    mandateId,
    owner: result.data?.owner,
    expired,
    ...fields,
    network: ctx.network,
  }, flags.human ?? false);
}
