import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { COIN_TYPES, COIN_DECIMALS } from "@sweefi/sui";
import type { SweefiContext } from "../context.js";

export function registerSupportedTool(server: McpServer, ctx: SweefiContext) {
  server.registerTool(
    "sweefi_supported_tokens",
    {
      title: "Supported Tokens",
      description:
        "List tokens supported by SweeFi on Sui. Returns coin type addresses, " +
        "decimal precision, and symbols for SUI, USDC, and USDT.",
    },
    async () => {
      const tokens = [
        { symbol: "SUI", type: COIN_TYPES.SUI, decimals: COIN_DECIMALS[COIN_TYPES.SUI] },
        { symbol: "USDC", type: COIN_TYPES.USDC, decimals: COIN_DECIMALS[COIN_TYPES.USDC] },
        { symbol: "USDT", type: COIN_TYPES.USDT, decimals: COIN_DECIMALS[COIN_TYPES.USDT] },
      ];

      const lines = tokens.map(
        (t) => `${t.symbol}: ${t.type} (${t.decimals} decimals)`,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `SweeFi supported tokens on ${ctx.network}:\n\n${lines.join("\n")}\n\nPackage ID: ${ctx.config.packageId}`,
          },
        ],
      };
    },
  );
}
