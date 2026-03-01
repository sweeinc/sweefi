import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SweefiContext } from "../context.js";
import { formatBalance, resolveCoinType, suiAddress } from "../utils/format.js";

export function registerBalanceTool(server: McpServer, ctx: SweefiContext) {
  server.registerTool(
    "sweefi_check_balance",
    {
      title: "Check Wallet Balance",
      description:
        "Check the SUI, USDC, or USDT balance for any Sui address. " +
        "Returns the balance in human-readable format with proper decimals.",
      inputSchema: {
        address: suiAddress("Wallet"),
        coinType: z
          .string()
          .optional()
          .describe('Token to check: "SUI", "USDC", "USDT", or full type string. Defaults to SUI.'),
      },
    },
    async ({ address, coinType }) => {
      const resolvedType = resolveCoinType(coinType, ctx.network);

      const balance = await ctx.suiClient.getBalance({
        owner: address,
        coinType: resolvedType,
      });

      const formatted = formatBalance(balance.totalBalance, resolvedType);

      return {
        content: [
          {
            type: "text" as const,
            text: `Balance for ${address}:\n${formatted}\n\nRaw: ${balance.totalBalance} (${balance.coinObjectCount} coin objects)`,
          },
        ],
      };
    },
  );
}
