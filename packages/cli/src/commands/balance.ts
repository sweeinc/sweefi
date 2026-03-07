/**
 * sweefi balance [address] [--coin SUI|USDC]
 *
 * Check wallet balance. Omit address to check own wallet (from SUI_PRIVATE_KEY).
 * Works without a wallet if an explicit address is provided.
 */

import type { CliContext } from "../context.js";
import { CliError, debug, withTimeout } from "../context.js";
import { outputSuccess, formatBalance } from "../output.js";
import type { RequestContext } from "../output.js";
import { resolveCoinType, validateAddress } from "../parse.js";

export async function balance(ctx: CliContext, args: string[], flags: { coin?: string; human?: boolean }, reqCtx: RequestContext): Promise<void> {
  const coinType = resolveCoinType(flags.coin, ctx.network);

  let address: string;
  if (args.length > 0 && args[0] && !args[0].startsWith("-")) {
    if (!args[0].startsWith("0x")) {
      throw new CliError("INVALID_ADDRESS", `Invalid address: "${args[0]}"`, false, "Sui addresses start with 0x");
    }
    address = validateAddress(args[0], "Address");
  } else if (ctx.signer) {
    address = ctx.signer.toSuiAddress();
  } else {
    throw new CliError(
      "NO_ADDRESS",
      "No address provided and no wallet configured",
      false,
      "Pass an address argument or set SUI_PRIVATE_KEY to check your own wallet",
    );
  }

  debug(ctx, "querying balance for", address, "coin:", coinType);
  const result = await withTimeout(ctx, ctx.suiClient.getBalance({ owner: address, coinType }), "getBalance");

  outputSuccess("balance", {
    address,
    balance: result.totalBalance,
    balanceFormatted: formatBalance(result.totalBalance, coinType),
    coin: coinType,
    coinObjects: Number(result.coinObjectCount),
    network: ctx.network,
  }, flags.human ?? false, reqCtx);
}
