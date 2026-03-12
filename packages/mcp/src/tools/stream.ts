import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SuiObjectChange } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { StreamContract, createBuilderConfig } from "@sweefi/sui";
import type { SweefiContext } from "../context.js";
import { requireSigner, checkSpendingLimit, recordSpend } from "../context.js";
import { resolveCoinType, formatBalance, parseAmount, assertTxSuccess, ZERO_ADDRESS, suiAddress, suiObjectId, optionalSuiAddress } from "../utils/format.js";

export function registerStreamTools(server: McpServer, ctx: SweefiContext) {
  const stream = new StreamContract(createBuilderConfig({
    packageId: ctx.config.packageId,
    protocolState: ctx.config.protocolStateId,
  }));

  server.registerTool(
    "sweefi_start_stream",
    {
      title: "Start Streaming Payment",
      description:
        "Start a streaming micropayment on Sui. Funds flow from payer to recipient " +
        "at a specified rate per second, with an on-chain budget cap (hard kill switch). " +
        "The recipient can claim accrued funds at any time. The payer can pause, resume, " +
        "or close the stream. If the payer disappears, the recipient can force-close after " +
        "the timeout period (permissionless recovery — no admin needed). " +
        "This is SweeFi's safety guardrail for AI agent spending. " +
        "Note: The stream is a shared object (goes through Sui consensus on each operation). " +
        "Requires a configured wallet.",
      inputSchema: {
        recipient: suiAddress("Recipient"),
        depositAmount: z.string().describe("Initial deposit in base units"),
        ratePerSecond: z.string().describe("Payment rate in base units per second"),
        budgetCap: z
          .string()
          .optional()
          .describe("Maximum total spend (gross). Defaults to depositAmount."),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
        feeMicroPercent: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .optional()
          .describe("Fee in micro-percent (0-1000000, where 1000000 = 100%). Default 0."),
        feeRecipient: optionalSuiAddress("Fee recipient"),
      },
    },
    async ({ recipient, depositAmount, ratePerSecond, budgetCap, coinType, feeMicroPercent, feeRecipient }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);
      const deposit = parseAmount(depositAmount, "depositAmount");
      checkSpendingLimit(ctx, deposit);
      const rate = parseAmount(ratePerSecond, "ratePerSecond");

      const tx = new Transaction();
      stream.create({
        coinType: resolvedType,
        sender: signer.toSuiAddress(),
        recipient,
        depositAmount: deposit,
        ratePerSecond: rate,
        budgetCap: budgetCap ? parseAmount(budgetCap, "budgetCap") : deposit,
        feeMicroPercent: feeMicroPercent ?? 0,
        feeRecipient: feeRecipient ?? ZERO_ADDRESS,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);
      recordSpend(ctx, deposit);

      const meterObj = result.objectChanges?.find(
        (c: SuiObjectChange) => c.type === "created" && c.objectType?.includes("StreamingMeter"),
      );
      const meterId = meterObj && "objectId" in meterObj ? meterObj.objectId : "unknown";
      const formatted = formatBalance(depositAmount, resolvedType);

      return {
        content: [
          {
            type: "text" as const,
            text: `Stream started!\n\nMeter ID: ${meterId}\nDeposit: ${formatted}\nRate: ${ratePerSecond} per second\nRecipient: ${recipient}\nTX Digest: ${result.digest}\nNetwork: ${ctx.network}\n\nThe recipient can now claim accrued funds. Use sweefi_stop_stream to close.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "sweefi_start_stream_with_timeout",
    {
      title: "Start Streaming Payment with Custom Timeout",
      description:
        "Start a streaming micropayment with a custom recipient_close timeout (v6 feature). " +
        "Same as sweefi_start_stream, but allows configuring how long the recipient must wait " +
        "before force-closing an abandoned stream. Minimum: 1 day. Default (if you use " +
        "sweefi_start_stream instead): 7 days. Use shorter timeouts for time-sensitive services, " +
        "longer for high-value long-running streams. " +
        "Requires a configured wallet.",
      inputSchema: {
        recipient: suiAddress("Recipient"),
        depositAmount: z.string().describe("Initial deposit in base units"),
        ratePerSecond: z.string().describe("Payment rate in base units per second"),
        recipientCloseTimeoutMs: z
          .string()
          .describe("Recipient close timeout in milliseconds. Minimum 86400000 (1 day)."),
        budgetCap: z
          .string()
          .optional()
          .describe("Maximum total spend (gross). Defaults to depositAmount."),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
        feeMicroPercent: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .optional()
          .describe("Fee in micro-percent (0-1000000, where 1000000 = 100%). Default 0."),
        feeRecipient: optionalSuiAddress("Fee recipient"),
      },
    },
    async ({ recipient, depositAmount, ratePerSecond, recipientCloseTimeoutMs, budgetCap, coinType, feeMicroPercent, feeRecipient }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);
      const deposit = parseAmount(depositAmount, "depositAmount");
      checkSpendingLimit(ctx, deposit);
      const rate = parseAmount(ratePerSecond, "ratePerSecond");
      const timeout = parseAmount(recipientCloseTimeoutMs, "recipientCloseTimeoutMs");

      const tx = new Transaction();
      stream.createWithTimeout({
        coinType: resolvedType,
        sender: signer.toSuiAddress(),
        recipient,
        depositAmount: deposit,
        ratePerSecond: rate,
        budgetCap: budgetCap ? parseAmount(budgetCap, "budgetCap") : deposit,
        feeMicroPercent: feeMicroPercent ?? 0,
        feeRecipient: feeRecipient ?? ZERO_ADDRESS,
        recipientCloseTimeoutMs: timeout,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);
      recordSpend(ctx, deposit);

      const meterObj = result.objectChanges?.find(
        (c: SuiObjectChange) => c.type === "created" && c.objectType?.includes("StreamingMeter"),
      );
      const meterId = meterObj && "objectId" in meterObj ? meterObj.objectId : "unknown";
      const formatted = formatBalance(depositAmount, resolvedType);
      const timeoutDays = (Number(recipientCloseTimeoutMs) / 86_400_000).toFixed(1);

      return {
        content: [
          {
            type: "text" as const,
            text: `Stream started with custom timeout!\n\nMeter ID: ${meterId}\nDeposit: ${formatted}\nRate: ${ratePerSecond} per second\nRecipient Close Timeout: ${timeoutDays} days\nRecipient: ${recipient}\nTX Digest: ${result.digest}\nNetwork: ${ctx.network}\n\nThe recipient can force-close after ${timeoutDays} days of inactivity.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "sweefi_stop_stream",
    {
      title: "Stop Streaming Payment",
      description:
        "Close a streaming payment meter. The recipient gets any unclaimed accrued funds, " +
        "and the remaining deposit is refunded to the payer. The meter object is consumed. " +
        "Requires a configured wallet.",
      inputSchema: {
        meterId: suiObjectId("StreamingMeter"),
        coinType: z.string().optional().describe('Token type of the stream. Defaults to "SUI".'),
      },
    },
    async ({ meterId, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);

      const tx = new Transaction();
      stream.close({
        coinType: resolvedType,
        meterId,
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
            text: `Stream closed!\n\nMeter: ${meterId}\nTX Digest: ${result.digest}\nNetwork: ${ctx.network}\n\nRemaining deposit refunded to payer. Accrued funds sent to recipient.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "sweefi_recipient_close_stream",
    {
      title: "Recipient Close Abandoned Stream",
      description:
        "Safety tool: allows the stream RECIPIENT to close an abandoned stream after " +
        "the budget is exhausted or the stream is inactive. Prevents funds from being " +
        "locked forever if the payer disappears. The recipient gets accrued funds and " +
        "any remaining balance is refunded to the payer. " +
        "Requires a configured wallet (must be the stream recipient).",
      inputSchema: {
        meterId: suiObjectId("StreamingMeter"),
        coinType: z.string().optional().describe('Token type of the stream. Defaults to "SUI".'),
      },
    },
    async ({ meterId, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);

      const tx = new Transaction();
      stream.recipientClose({
        coinType: resolvedType,
        meterId,
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
            text: `Abandoned stream recovered!\n\nMeter: ${meterId}\nTX Digest: ${result.digest}\nNetwork: ${ctx.network}\n\nAccrued funds claimed by recipient. Any remaining balance refunded to payer.`,
          },
        ],
      };
    },
  );
}
