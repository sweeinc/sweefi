import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Transaction } from "@mysten/sui/transactions";
import { PaymentContract, createBuilderConfig } from "@sweefi/sui";
import type { SweefiContext } from "../context.js";
import { requireSigner, checkSpendingLimit, recordSpend } from "../context.js";
import { resolveCoinType, formatBalance, parseAmount, assertTxSuccess, ZERO_ADDRESS, suiAddress, optionalSuiAddress } from "../utils/format.js";

export function registerProveTool(server: McpServer, ctx: SweefiContext) {
  const payment = new PaymentContract(createBuilderConfig({
    packageId: ctx.config.packageId,
    protocolState: ctx.config.protocolStateId,
  }));

  server.registerTool(
    "sweefi_pay_and_prove",
    {
      title: "Atomic Pay-to-Access (SEAL)",
      description:
        "The hero transaction: pay a seller AND receive an on-chain PaymentReceipt in " +
        "ONE atomic PTB. The receipt ID becomes a SEAL access condition — the seller " +
        "encrypts content against this receipt, and only the receipt owner can decrypt. " +
        "If payment fails, no receipt. If receipt transfer fails, payment reverts. " +
        "Zero reconciliation gap. Zero support tickets. " +
        "Use this for pay-to-decrypt, pay-to-access, and token-gated content. " +
        "Requires a configured wallet.",
      inputSchema: {
        recipient: suiAddress("Seller/recipient"),
        amount: z.string().describe("Amount in base units (e.g., '1000000000' for 1 SUI)"),
        receiptDestination: optionalSuiAddress("Receipt destination"),
        coinType: z
          .string()
          .optional()
          .describe('Token to pay with: "SUI", "USDC", "USDT", or full type. Defaults to SUI.'),
        memo: z
          .string()
          .optional()
          .describe("Optional memo — use 'seal:<content-id>' to link receipt to encrypted content"),
        feeMicroPercent: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .optional()
          .describe("Fee in micro-percent (0-1000000, where 1000000 = 100%). Defaults to 0."),
        feeRecipient: optionalSuiAddress("Fee recipient"),
      },
    },
    async ({ recipient, amount, receiptDestination, coinType, memo, feeMicroPercent, feeRecipient }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);
      const amountBigint = parseAmount(amount);
      checkSpendingLimit(ctx, amountBigint);
      const senderAddr = signer.toSuiAddress();

      const tx = new Transaction();
      const receipt = payment.payComposable({
        coinType: resolvedType,
        sender: senderAddr,
        recipient,
        amount: amountBigint,
        feeMicroPercent: feeMicroPercent ?? 0,
        feeRecipient: feeRecipient ?? ZERO_ADDRESS,
        memo,
      })(tx);
      tx.transferObjects([receipt], receiptDestination ?? senderAddr);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);
      recordSpend(ctx, amountBigint);

      const digest = result.digest;
      const formatted = formatBalance(amount, resolvedType);

      const receiptObj = result.objectChanges?.find(
        (c) => c.type === "created" && c.objectType?.includes("PaymentReceipt"),
      );
      const receiptId = receiptObj && "objectId" in receiptObj ? receiptObj.objectId : "unknown";
      const destination = receiptDestination ?? senderAddr;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Atomic pay-to-access complete!\n\n` +
              `Amount: ${formatted}\n` +
              `Recipient: ${recipient}\n` +
              `Receipt ID: ${receiptId}\n` +
              `Receipt Owner: ${destination}\n` +
              `TX Digest: ${digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `SEAL Integration:\n` +
              `  The receipt ID (${receiptId}) is now a SEAL access condition.\n` +
              `  Content encrypted against this ID can only be decrypted by the receipt owner.\n` +
              `  One transaction. Atomic. No reconciliation.`,
          },
        ],
      };
    },
  );
}
