import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SuiObjectChange } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { PrepaidContract, createBuilderConfig } from "@sweefi/sui";
import { UNLIMITED_CALLS } from "@sweefi/sui/ptb";
import type { SweefiContext } from "../context.js";
import { requireSigner, checkSpendingLimit, recordSpend } from "../context.js";
import { resolveCoinType, formatBalance, parseAmount, parseAmountOrZero, assertTxSuccess, ZERO_ADDRESS, suiAddress, suiObjectId, optionalSuiAddress } from "../utils/format.js";

export function registerPrepaidTools(server: McpServer, ctx: SweefiContext) {
  const prepaid = new PrepaidContract(createBuilderConfig({
    packageId: ctx.config.packageId,
    protocolState: ctx.config.protocolStateId,
  }));
  // ── Prepaid Deposit ──────────────────────────────────────────
  server.registerTool(
    "sweefi_prepaid_deposit",
    {
      title: "Deposit Prepaid Balance",
      description:
        "Deposit funds into a prepaid balance for an API provider on Sui. " +
        "Creates a shared PrepaidBalance object. The provider claims funds by submitting " +
        "cumulative API call counts — Move enforces rate_per_call and max_calls caps. " +
        "Trust model: The provider's call count is NOT verified on-chain. Your maximum " +
        "loss is the deposit amount. Use small deposits ($5-$50) with frequent top-ups. " +
        "The withdrawal_delay_ms sets a grace period before you can withdraw — the provider " +
        "can still claim during this window. " +
        "Requires a configured wallet and protocolStateId.",
      inputSchema: {
        provider: suiAddress("Provider"),
        amount: z.string().describe("Deposit amount in base units (e.g., '1000000000' for 1 SUI)"),
        ratePerCall: z.string().describe("Maximum base units per API call (rate cap)"),
        maxCalls: z
          .string()
          .optional()
          .describe("Maximum total calls. Omit for unlimited."),
        withdrawalDelayMs: z
          .string()
          .describe("Grace period in ms before withdrawal completes. Min 60000 (1 min), max 604800000 (7 days)."),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
        feeMicroPercent: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .optional()
          .describe("Fee in micro-percent (0-1000000, where 1000000 = 100%) charged on claims. Default 0."),
        feeRecipient: optionalSuiAddress("Fee recipient"),
      },
    },
    async ({ provider, amount, ratePerCall, maxCalls, withdrawalDelayMs, coinType, feeMicroPercent, feeRecipient }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);
      const depositAmount = parseAmount(amount);
      const rate = parseAmount(ratePerCall, "ratePerCall");
      const delay = parseAmount(withdrawalDelayMs, "withdrawalDelayMs");

      checkSpendingLimit(ctx, depositAmount);

      const tx = new Transaction();
      prepaid.deposit({
        coinType: resolvedType,
        sender: signer.toSuiAddress(),
        provider,
        amount: depositAmount,
        ratePerCall: rate,
        maxCalls: maxCalls !== undefined ? parseAmount(maxCalls, "maxCalls") : UNLIMITED_CALLS,
        withdrawalDelayMs: delay,
        feeMicroPercent: feeMicroPercent ?? 0,
        feeRecipient: feeRecipient ?? ZERO_ADDRESS,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);
      recordSpend(ctx, depositAmount);

      const balanceObj = result.objectChanges?.find(
        (c: SuiObjectChange) => c.type === "created" && c.objectType?.includes("PrepaidBalance"),
      );
      const balanceId = balanceObj && "objectId" in balanceObj ? balanceObj.objectId : "unknown";
      const formatted = formatBalance(amount, resolvedType);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Prepaid balance created!\n\n` +
              `Balance ID: ${balanceId}\n` +
              `Deposit: ${formatted}\n` +
              `Provider: ${provider}\n` +
              `Rate per call: ${ratePerCall} base units\n` +
              `Max calls: ${maxCalls ?? "unlimited"}\n` +
              `Withdrawal delay: ${Number(withdrawalDelayMs) / 60000} minutes\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `The provider can now claim funds by submitting cumulative call counts. ` +
              `Use sweefi_prepaid_top_up to add more funds or sweefi_prepaid_request_withdrawal to reclaim.`,
          },
        ],
      };
    },
  );

  // ── Prepaid Request Withdrawal ─────────────────────────────
  server.registerTool(
    "sweefi_prepaid_request_withdrawal",
    {
      title: "Request Prepaid Withdrawal",
      description:
        "Start the two-phase withdrawal process for a prepaid balance. This begins the " +
        "grace period (withdrawal_delay_ms) during which the provider can still submit final claims. " +
        "The timer is anchored to the request timestamp — late provider claims do NOT restart it. " +
        "After the grace period, call sweefi_prepaid_finalize_withdrawal to complete. " +
        "Use sweefi_prepaid_cancel_withdrawal to abort. " +
        "Requires a configured wallet (must be the agent/depositor).",
      inputSchema: {
        balanceId: suiObjectId("PrepaidBalance"),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
      },
    },
    async ({ balanceId, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);

      const tx = new Transaction();
      prepaid.requestWithdrawal({
        coinType: resolvedType,
        balanceId,
        sender: signer.toSuiAddress(),
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      assertTxSuccess(result);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Withdrawal requested!\n\n` +
              `Balance: ${balanceId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `Grace period started (timer anchored to this request — late provider claims do NOT restart it). ` +
              `The provider can still claim during this window. ` +
              `After the delay, call sweefi_prepaid_finalize_withdrawal to complete. ` +
              `Call sweefi_prepaid_cancel_withdrawal to abort.`,
          },
        ],
      };
    },
  );

  // ── Prepaid Finalize Withdrawal ──────────────────────────────
  server.registerTool(
    "sweefi_prepaid_finalize_withdrawal",
    {
      title: "Finalize Prepaid Withdrawal",
      description:
        "Complete a prepaid withdrawal after the grace period has elapsed. Returns remaining " +
        "funds to the agent and destroys the PrepaidBalance object. " +
        "Fails with PREPAID_WITHDRAWAL_LOCKED if called before the delay has passed. " +
        "Requires a configured wallet (must be the agent/depositor).",
      inputSchema: {
        balanceId: suiObjectId("PrepaidBalance"),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
      },
    },
    async ({ balanceId, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);

      const tx = new Transaction();
      prepaid.finalizeWithdrawal({
        coinType: resolvedType,
        balanceId,
        sender: signer.toSuiAddress(),
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      assertTxSuccess(result);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Withdrawal complete!\n\n` +
              `Balance: ${balanceId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `Remaining funds returned to your wallet. PrepaidBalance object destroyed.`,
          },
        ],
      };
    },
  );

  // ── Prepaid Cancel Withdrawal ────────────────────────────────
  server.registerTool(
    "sweefi_prepaid_cancel_withdrawal",
    {
      title: "Cancel Prepaid Withdrawal",
      description:
        "Cancel a pending withdrawal request, returning the prepaid balance to normal operation. " +
        "Top-ups become possible again after cancellation. " +
        "Requires a configured wallet (must be the agent/depositor).",
      inputSchema: {
        balanceId: suiObjectId("PrepaidBalance"),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
      },
    },
    async ({ balanceId, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);

      const tx = new Transaction();
      prepaid.cancelWithdrawal({
        coinType: resolvedType,
        balanceId,
        sender: signer.toSuiAddress(),
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      assertTxSuccess(result);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Withdrawal cancelled!\n\n` +
              `Balance: ${balanceId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `Prepaid balance is back to normal operation. Top-ups are allowed again.`,
          },
        ],
      };
    },
  );

  // ── Prepaid Top Up ───────────────────────────────────────────
  server.registerTool(
    "sweefi_prepaid_top_up",
    {
      title: "Top Up Prepaid Balance",
      description:
        "Add more funds to an existing prepaid balance. Blocked during a pending withdrawal " +
        "(cancel the withdrawal first). " +
        "Requires a configured wallet (must be the agent/depositor) and protocolStateId.",
      inputSchema: {
        balanceId: suiObjectId("PrepaidBalance"),
        amount: z.string().describe("Additional deposit in base units"),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
      },
    },
    async ({ balanceId, amount, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);
      const topUpAmount = parseAmount(amount);

      checkSpendingLimit(ctx, topUpAmount);

      const tx = new Transaction();
      prepaid.topUp({
        coinType: resolvedType,
        balanceId,
        sender: signer.toSuiAddress(),
        amount: topUpAmount,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      assertTxSuccess(result);
      recordSpend(ctx, topUpAmount);

      const formatted = formatBalance(amount, resolvedType);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Top-up successful!\n\n` +
              `Balance: ${balanceId}\n` +
              `Added: ${formatted}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `Use sweefi_prepaid_status to check the new balance.`,
          },
        ],
      };
    },
  );

  // ── Prepaid Agent Close ────────────────────────────────────────
  server.registerTool(
    "sweefi_prepaid_agent_close",
    {
      title: "Close Exhausted Prepaid Balance",
      description:
        "Close a PrepaidBalance that has been fully consumed (0 remaining funds). " +
        "Destroys the shared object and returns the storage rebate to the agent. " +
        "Fails with PREPAID_BALANCE_NOT_EXHAUSTED if funds remain — use " +
        "sweefi_prepaid_request_withdrawal instead for non-zero balances. " +
        "Requires a configured wallet (must be the agent/depositor).",
      inputSchema: {
        balanceId: suiObjectId("PrepaidBalance"),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
      },
    },
    async ({ balanceId, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);

      const tx = new Transaction();
      prepaid.agentClose({
        coinType: resolvedType,
        balanceId,
        sender: signer.toSuiAddress(),
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      assertTxSuccess(result);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Prepaid balance closed!\n\n` +
              `Balance: ${balanceId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `The exhausted PrepaidBalance object has been destroyed. Storage rebate returned to your wallet.`,
          },
        ],
      };
    },
  );

  // ── Prepaid Status (read-only) ───────────────────────────────
  server.registerTool(
    "sweefi_prepaid_status",
    {
      title: "Check Prepaid Balance Status",
      description:
        "Read-only: Fetch the on-chain state of a PrepaidBalance. Shows remaining funds, " +
        "claimed call count, rate per call, max calls, withdrawal status, and provider/agent addresses. " +
        "Does NOT require a wallet.",
      inputSchema: {
        balanceId: suiObjectId("PrepaidBalance"),
      },
    },
    async ({ balanceId }) => {
      const obj = await ctx.suiClient.getObject({
        id: balanceId,
        options: { showContent: true },
      });

      if (!obj.data?.content || obj.data.content.dataType !== "moveObject") {
        return {
          content: [
            {
              type: "text" as const,
              text: `PrepaidBalance not found: ${balanceId}\n\nThe object may have been consumed (withdrawal finalized or closed).`,
            },
          ],
        };
      }

      const fields = obj.data.content.fields as Record<string, any>;

      const remaining = fields.deposited?.fields?.value ?? fields.deposited ?? "unknown";
      const agent = fields.agent ?? "unknown";
      const provider = fields.provider ?? "unknown";
      const ratePerCall = fields.rate_per_call ?? "unknown";
      const claimedCalls = fields.claimed_calls ?? "0";
      const maxCalls = fields.max_calls ?? "unknown";
      const withdrawalPending = fields.withdrawal_pending ?? false;
      const withdrawalDelayMs = fields.withdrawal_delay_ms ?? "unknown";
      const withdrawalRequestedMs = fields.withdrawal_requested_ms ?? "0";
      const lastClaimMs = fields.last_claim_ms ?? "0";
      const feeMicroPct = fields.fee_micro_pct ?? "0";
      const feeRecipient = fields.fee_recipient ?? "unknown";

      const isUnlimited = String(maxCalls) === UNLIMITED_CALLS;

      let withdrawalInfo = `Withdrawal pending: ${withdrawalPending}`;
      if (withdrawalPending && withdrawalRequestedMs !== "0" && withdrawalDelayMs !== "unknown") {
        const finalizeAfterMs = Number(withdrawalRequestedMs) + Number(withdrawalDelayMs);
        const finalizeAfter = new Date(finalizeAfterMs).toISOString();
        const now = Date.now();
        const canFinalize = now >= finalizeAfterMs;
        withdrawalInfo +=
          `\nWithdrawal requested: ${new Date(Number(withdrawalRequestedMs)).toISOString()}` +
          `\nFinalize after: ${finalizeAfter}` +
          `\nReady to finalize: ${canFinalize ? "YES" : `no (${Math.ceil((finalizeAfterMs - now) / 60000)} min remaining)`}`;
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              `PrepaidBalance Status\n\n` +
              `Balance ID: ${balanceId}\n` +
              `Agent: ${agent}\n` +
              `Provider: ${provider}\n` +
              `Remaining: ${remaining} base units\n` +
              `Rate per call: ${ratePerCall} base units\n` +
              `Claimed calls: ${claimedCalls}\n` +
              `Max calls: ${isUnlimited ? "unlimited" : maxCalls}\n` +
              `${withdrawalInfo}\n` +
              `Withdrawal delay: ${Number(withdrawalDelayMs) / 60000} minutes\n` +
              `Last claim: ${lastClaimMs === "0" ? "never" : new Date(Number(lastClaimMs)).toISOString()}\n` +
              `Fee: ${feeMicroPct} micro-percent\n` +
              `Fee recipient: ${feeRecipient}\n` +
              `Network: ${ctx.network}`,
          },
        ],
      };
    },
  );
}

/**
 * Register provider-side prepaid tools (claim).
 * Separated from agent-side tools because a consumer agent should not
 * have claim tools in its tool list — it would confuse the LLM.
 * Enable via `enableProviderTools: true` in config or MCP_ENABLE_PROVIDER_TOOLS=true.
 */
export function registerPrepaidProviderTools(server: McpServer, ctx: SweefiContext) {
  const prepaid = new PrepaidContract(createBuilderConfig({
    packageId: ctx.config.packageId,
    protocolState: ctx.config.protocolStateId,
  }));
  // ── Prepaid Claim ────────────────────────────────────────────
  server.registerTool(
    "sweefi_prepaid_claim",
    {
      title: "Claim Prepaid Earnings",
      description:
        "Provider claims earned funds from a prepaid balance by submitting the cumulative " +
        "API call count. Move computes delta = (new_count - last_claimed_count), then transfers " +
        "delta * rate_per_call (minus fees) to the provider. " +
        "Zero-delta claims (same count) are safe no-ops. Claims are allowed during pending withdrawal " +
        "(provider's grace period). " +
        "Requires a configured wallet (must be the authorized provider).",
      inputSchema: {
        balanceId: suiObjectId("PrepaidBalance"),
        cumulativeCallCount: z
          .string()
          .describe("Total cumulative calls served (not delta). Move computes the delta from last claim."),
        coinType: z.string().optional().describe('Token type of the balance. Defaults to "SUI".'),
      },
    },
    async ({ balanceId, cumulativeCallCount, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);
      const callCount = parseAmountOrZero(cumulativeCallCount, "cumulativeCallCount");

      const tx = new Transaction();
      prepaid.claim({
        coinType: resolvedType,
        balanceId,
        sender: signer.toSuiAddress(),
        cumulativeCallCount: callCount,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true },
      });
      assertTxSuccess(result);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Prepaid claim submitted!\n\n` +
              `Balance: ${balanceId}\n` +
              `Cumulative calls: ${cumulativeCallCount}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `Earnings transferred to provider (minus fees). ` +
              `Use sweefi_prepaid_status to check remaining balance.`,
          },
        ],
      };
    },
  );
}
