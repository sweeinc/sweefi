/**
 * sweefi receipt <object-id>
 *
 * Fetch an on-chain payment receipt by object ID.
 * Receipts are NFTs minted by pay_and_keep / release_escrow operations.
 */

import type { CliContext } from "../context.js";
import { CliError, withTimeout } from "../context.js";
import { outputSuccess } from "../output.js";
import type { RequestContext } from "../output.js";
import { validateObjectId } from "../parse.js";

export async function receipt(ctx: CliContext, args: string[], flags: { human?: boolean }, reqCtx: RequestContext): Promise<void> {
  if (args.length < 1) {
    throw new CliError("MISSING_ARGS", "Usage: sweefi receipt <object-id>", false, "Pass the receipt object ID (0x...)");
  }

  const objectId = validateObjectId(args[0], "Receipt ID");
  const result = await withTimeout(ctx, ctx.suiClient.getObject({
    id: objectId,
    options: { showContent: true, showType: true, showOwner: true },
  }), "getObject");

  if (result.error) {
    throw new CliError(
      "OBJECT_NOT_FOUND",
      `Receipt ${objectId} not found: ${result.error.code}`,
      false,
      "Check the object ID and network",
    );
  }

  const content = result.data?.content;
  const fields = content?.dataType === "moveObject" ? (content.fields as Record<string, unknown>) : {};
  const type = content?.dataType === "moveObject" ? content.type : "unknown";

  outputSuccess("receipt", {
    receiptId: objectId,
    type,
    owner: result.data?.owner,
    fields,
    network: ctx.network,
  }, flags.human ?? false, reqCtx);
}
