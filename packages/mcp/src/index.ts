#!/usr/bin/env node

/**
 * @sweepay/mcp — MCP server exposing SweePay payment tools for AI agents.
 *
 * The safety layer for autonomous agent commerce on Sui.
 *
 * 20 tools covering all 4 SweePay contracts:
 *   - Payment: pay, pay_and_prove, create_invoice, pay_invoice
 *   - Streaming: start_stream, start_stream_with_timeout, stop_stream, recipient_close_stream
 *   - Escrow: create_escrow, release_escrow, refund_escrow, dispute_escrow
 *   - Admin: protocol_status, pause_protocol, unpause_protocol, burn_admin_cap
 *   - Read-only: check_balance, check_payment, get_receipt, supported_tokens
 *
 * Usage (stdio — for Claude Desktop / Cursor / etc.):
 *   SUI_PRIVATE_KEY=suiprivkey1... npx @sweepay/mcp
 *
 * Usage (programmatic):
 *   import { createSweepayMcpServer } from '@sweepay/mcp';
 *   const { server } = createSweepayMcpServer({ network: 'testnet' });
 *
 * @module
 */

export { createSweepayMcpServer } from "./server.js";
export { createContext, requireSigner } from "./context.js";
export type { SweepayContext, SweepayMcpConfig } from "./context.js";

// When run directly (stdio mode), start the server
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSweepayMcpServer } from "./server.js";

async function main() {
  const { server, context } = createSweepayMcpServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const walletStatus = context.signer
    ? `Wallet: ${context.signer.toSuiAddress()}`
    : "Wallet: not configured (read-only mode)";

  // Log to stderr so it doesn't interfere with stdio JSON-RPC
  console.error(`@sweepay/mcp started`);
  console.error(`Network: ${context.network}`);
  console.error(`Package: ${context.config.packageId}`);
  console.error(walletStatus);
  console.error(`Tools: 20 registered`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
