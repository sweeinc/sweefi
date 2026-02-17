/**
 * @sweepay/mcp — MCP server exposing SweePay payment tools for AI agents.
 *
 * The safety layer for autonomous agent commerce on Sui.
 *
 * 30 tools by default (+ 1 provider, + 4 admin with opt-in flags):
 *   - Payment: pay, pay_and_prove, create_invoice, pay_invoice
 *   - Streaming: start_stream, start_stream_with_timeout, stop_stream, recipient_close_stream
 *   - Escrow: create_escrow, release_escrow, refund_escrow, dispute_escrow
 *   - Prepaid: deposit, request_withdrawal, finalize_withdrawal, cancel_withdrawal, top_up, agent_close, status
 *   - Mandate: create_mandate, create_agent_mandate, basic_mandated_pay, agent_mandated_pay, revoke, create_registry, inspect
 *   - Read-only: check_balance, check_payment, get_receipt, supported_tokens
 *   - Provider (opt-in): prepaid_claim
 *   - Admin (opt-in): protocol_status, pause_protocol, unpause_protocol, burn_admin_cap
 *
 * Usage (stdio — for Claude Desktop / Cursor / etc.):
 *   SUI_PRIVATE_KEY=suiprivkey1... npx @sweepay/mcp
 *
 * Usage (programmatic — no side effects):
 *   import { createSweepayMcpServer } from '@sweepay/mcp';
 *   const { server } = createSweepayMcpServer({ network: 'testnet' });
 *
 * @module
 */

export { createSweepayMcpServer } from "./server.js";
export { createContext, requireSigner } from "./context.js";
export type { SweepayContext, SweepayMcpConfig } from "./context.js";
