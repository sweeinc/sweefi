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

  const enableAdminTools = config?.enableAdminTools
    ?? process.env.MCP_ENABLE_ADMIN_TOOLS === "true";
  const enableProviderTools = config?.enableProviderTools
    ?? process.env.MCP_ENABLE_PROVIDER_TOOLS === "true";

  // D-04: Warn loudly when admin tools are enabled — these can pause the protocol
  // or irreversibly burn the AdminCap. Operators should ensure this is intentional.
  if (enableAdminTools) {
    console.warn(
      "[sweepay-mcp] ⚠️  Admin tools ENABLED (pause, unpause, burn AdminCap). " +
      "These are destructive operations. Set MCP_ENABLE_ADMIN_TOOLS=false or " +
      "omit it to disable."
    );
  }

  if (enableProviderTools) {
    console.warn(
      "[sweepay-mcp] Provider tools ENABLED (prepaid claim). " +
      "Only enable this when running as a provider, not a consumer agent."
    );
  }

  registerAllTools(server, context, { enableAdminTools, enableProviderTools });

  return { server, context };
}
