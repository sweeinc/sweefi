#!/usr/bin/env node

/**
 * CLI entry point for @sweefi/mcp.
 * Starts the MCP server over stdio for use with Claude Desktop, Cursor, etc.
 *
 * Usage:
 *   SUI_PRIVATE_KEY=suiprivkey1... npx @sweefi/mcp
 *   SUI_PRIVATE_KEY=suiprivkey1... sweefi-mcp
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSweefiMcpServer } from "./server.js";

async function main() {
  const { server, context } = createSweefiMcpServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const walletStatus = context.signer
    ? `Wallet: ${context.signer.toSuiAddress()}`
    : "Wallet: not configured (read-only mode)";

  // Log to stderr so it doesn't interfere with stdio JSON-RPC
  console.error(`@sweefi/mcp started`);
  console.error(`Network: ${context.network}`);
  console.error(`Package: ${context.config.packageId}`);
  console.error(walletStatus);

  const flags: string[] = [];
  if (process.env.MCP_ENABLE_ADMIN_TOOLS === "true") flags.push("admin");
  if (process.env.MCP_ENABLE_PROVIDER_TOOLS === "true") flags.push("provider");
  const flagStr = flags.length > 0 ? ` (${flags.join(", ")} tools enabled)` : "";
  console.error(`Tools: registered${flagStr}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
