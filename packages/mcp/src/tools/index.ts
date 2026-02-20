import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SweefiContext } from "../context.js";
import { registerBalanceTool } from "./balance.js";
import { registerSupportedTool } from "./supported.js";
import { registerReceiptTool } from "./receipt.js";
import { registerPayTool } from "./pay.js";
import { registerInvoiceTools } from "./invoice.js";
import { registerStreamTools } from "./stream.js";
import { registerEscrowTools } from "./escrow.js";
import { registerProveTool } from "./prove.js";
import { registerAdminTools } from "./admin.js";
import { registerPrepaidTools, registerPrepaidProviderTools } from "./prepaid.js";
import { registerMandateTools } from "./mandate.js";

export interface RegisterToolsOptions {
  /** Enable admin tools (pause/unpause/burn). Defaults to false. */
  enableAdminTools?: boolean;
  /** Enable provider-side tools (prepaid claim). Defaults to false.
   *  Only enable when the MCP server is running as a provider, not a consumer agent. */
  enableProviderTools?: boolean;
}

/**
 * Register SweeFi tools on the MCP server.
 * Admin tools (pause/unpause/burn) are only registered when explicitly opted in.
 * Provider tools (prepaid claim) are only registered when explicitly opted in.
 */
export function registerAllTools(server: McpServer, ctx: SweefiContext, opts?: RegisterToolsOptions) {
  // Read-only tools (no wallet needed)
  registerBalanceTool(server, ctx);
  registerSupportedTool(server, ctx);
  registerReceiptTool(server, ctx); // sweefi_get_receipt + sweefi_check_payment

  // Transaction tools (wallet required)
  registerPayTool(server, ctx);
  registerProveTool(server, ctx); // sweefi_pay_and_prove (atomic SEAL flow)
  registerInvoiceTools(server, ctx); // sweefi_create_invoice + sweefi_pay_invoice
  registerStreamTools(server, ctx); // sweefi_start_stream + sweefi_stop_stream + sweefi_recipient_close_stream
  registerEscrowTools(server, ctx); // sweefi_create/release/refund/dispute_escrow
  registerPrepaidTools(server, ctx); // sweefi_prepaid_deposit/request_withdrawal/finalize/cancel/top_up/agent_close/status
  registerMandateTools(server, ctx); // sweefi_create_mandate/create_agent_mandate/basic_mandated_pay/agent_mandated_pay/revoke/registry/inspect

  // Provider tools register the provider-side of two-party schemes (e.g., prepaid claim).
  // A consumer agent should NOT have these — it would confuse the LLM.
  if (opts?.enableProviderTools) {
    registerPrepaidProviderTools(server, ctx); // sweefi_prepaid_claim
  }

  // Admin tools require explicit opt-in — a compromised agent calling
  // burn_admin_cap is an irreversible disaster.
  if (opts?.enableAdminTools) {
    registerAdminTools(server, ctx);
  }
}
