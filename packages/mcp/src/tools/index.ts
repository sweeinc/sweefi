import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SweepayContext } from "../context.js";
import { registerBalanceTool } from "./balance.js";
import { registerSupportedTool } from "./supported.js";
import { registerReceiptTool } from "./receipt.js";
import { registerPayTool } from "./pay.js";
import { registerInvoiceTools } from "./invoice.js";
import { registerStreamTools } from "./stream.js";
import { registerEscrowTools } from "./escrow.js";
import { registerProveTool } from "./prove.js";
import { registerAdminTools } from "./admin.js";

/**
 * Register all SweePay tools on the MCP server.
 * 19 tools total: 5 read-only + 14 transaction.
 */
export function registerAllTools(server: McpServer, ctx: SweepayContext) {
  // Read-only tools (no wallet needed)
  registerBalanceTool(server, ctx);
  registerSupportedTool(server, ctx);
  registerReceiptTool(server, ctx); // sweepay_get_receipt + sweepay_check_payment

  // Transaction tools (wallet required)
  registerPayTool(server, ctx);
  registerProveTool(server, ctx); // sweepay_pay_and_prove (atomic SEAL flow)
  registerInvoiceTools(server, ctx); // sweepay_create_invoice + sweepay_pay_invoice
  registerStreamTools(server, ctx); // sweepay_start_stream + sweepay_stop_stream + sweepay_recipient_close_stream
  registerEscrowTools(server, ctx); // sweepay_create/release/refund/dispute_escrow
  registerAdminTools(server, ctx); // sweepay_protocol_status + sweepay_pause/unpause/burn
}
