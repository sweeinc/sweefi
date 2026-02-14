import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createContext } from "./context.js";
import { registerAllTools } from "./tools/index.js";
import type { SweepayMcpConfig, SweepayContext } from "./context.js";

/**
 * Create a configured SweePay MCP server with all payment tools registered.
 *
 * @example
 * ```typescript
 * import { createSweepayMcpServer } from '@sweepay/mcp';
 *
 * const { server, context } = createSweepayMcpServer({
 *   network: 'testnet',
 *   privateKey: process.env.SUI_PRIVATE_KEY,
 * });
 * ```
 */
export function createSweepayMcpServer(config?: SweepayMcpConfig): {
  server: McpServer;
  context: SweepayContext;
} {
  const context = createContext(config);

  const server = new McpServer(
    {
      name: "@sweepay/mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerAllTools(server, context);

  return { server, context };
}
