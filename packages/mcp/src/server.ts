import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createContext } from "./context.js";
import { registerAllTools } from "./tools/index.js";
import type { SweefiMcpConfig, SweefiContext } from "./context.js";

// Single source of truth for the version reported to MCP clients.
// Must match package.json — prepublishOnly script catches drift.
const VERSION = "0.1.0";

/**
 * Create a configured SweeFi MCP server with all payment tools registered.
 *
 * @example
 * ```typescript
 * import { createSweefiMcpServer } from '@sweefi/mcp';
 *
 * const { server, context } = createSweefiMcpServer({
 *   network: 'testnet',
 *   privateKey: process.env.SUI_PRIVATE_KEY,
 * });
 * ```
 */
export function createSweefiMcpServer(config?: SweefiMcpConfig): {
  server: McpServer;
  context: SweefiContext;
} {
  const context = createContext(config);

  const server = new McpServer(
    {
      name: "@sweefi/mcp",
      version: VERSION,
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
      "[sweefi-mcp] ⚠️  Admin tools ENABLED (pause, unpause, burn AdminCap). " +
      "These are destructive operations. Set MCP_ENABLE_ADMIN_TOOLS=false or " +
      "omit it to disable."
    );
  }

  if (enableProviderTools) {
    console.warn(
      "[sweefi-mcp] Provider tools ENABLED (prepaid claim). " +
      "Only enable this when running as a provider, not a consumer agent."
    );
  }

  // Warn when running on mainnet with a signer but no spending limits.
  // On testnet/devnet there's no real money at risk. Without a signer,
  // transaction tools are disabled anyway. If limits are already set,
  // the operator has explicitly opted in.
  if (
    context.network === "mainnet" &&
    context.signer !== null &&
    context.spendingLimits.maxPerTx === 0n &&
    context.spendingLimits.maxPerSession === 0n
  ) {
    console.warn(
      "[sweefi-mcp] ⚠️  Running on MAINNET with NO spending limits. " +
      "Set MCP_MAX_PER_TX and MCP_MAX_PER_SESSION (or maxAmountPerTx/maxAmountPerSession " +
      "in config) to guard against LLM misbehavior. On-chain Mandates provide the " +
      "real security boundary, but MCP-level limits catch mistakes early."
    );
  }

  registerAllTools(server, context, { enableAdminTools, enableProviderTools });

  return { server, context };
}
