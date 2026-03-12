import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Transaction } from "@mysten/sui/transactions";
import { PaymentContract, createBuilderConfig } from "@sweefi/sui";
import type { SweefiContext } from "../context.js";
import { requireSigner, checkSpendingLimit, recordSpend } from "../context.js";
import { resolveCoinType, formatBalance, parseAmount, assertTxSuccess, ZERO_ADDRESS, suiAddress, optionalSuiAddress } from "../utils/format.js";

export function registerPayTool(server: McpServer, ctx: SweefiContext) {
  const payment = new PaymentContract(createBuilderConfig({
    packageId: ctx.config.packageId,
    protocolState: ctx.config.protocolStateId,
  }));

  server.registerTool(
    "sweefi_pay",
    {
      title: "Make Payment",
      description:
        "Make a direct on-chain payment on Sui. Sends tokens to a recipient with " +
        "optional fee splitting and memo. Returns the transaction digest and on-chain " +
        "PaymentReceipt ID. The receipt is an owned object — usable as a SEAL access " +
        "condition for pay-to-decrypt flows. Fee parameters are caller-set (not protocol-enforced), " +
        "so verify fee settings when using a third-party facilitator. " +
        "Requires a configured wallet (SUI_PRIVATE_KEY).",
      inputSchema: {
        recipient: suiAddress("Recipient"),
        amount: z.string().describe("Amount in base units (e.g., '1000000000' for 1 SUI)"),
        coinType: z
          .string()
          .optional()
          .describe('Token to pay with: "SUI", "USDC", "USDT", or full type. Defaults to SUI.'),
        memo: z.string().optional().describe("Optional payment memo (UTF-8 string)"),
        feeMicroPercent: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .optional()
          .describe("Fee in micro-percent (0-1000000, where 1000000 = 100%). Defaults to 0 (no fee)."),
        feeRecipient: optionalSuiAddress("Fee recipient"),
      },
    },
    async ({ recipient, amount, coinType, memo, feeMicroPercent, feeRecipient }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);
      const amountBigint = parseAmount(amount);

      // Enforce spending limits before signing
      checkSpendingLimit(ctx, amountBigint);

      const fee = feeMicroPercent ?? 0;
      const feeAddr = feeRecipient ?? ZERO_ADDRESS;

      const tx = new Transaction();
      payment.pay({
        coinType: resolvedType,
        sender: signer.toSuiAddress(),
        recipient,
        amount: amountBigint,
        feeMicroPercent: fee,
        feeRecipient: feeAddr,
        memo,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);
      recordSpend(ctx, amountBigint);

      const digest = result.digest;
      const formatted = formatBalance(amount, resolvedType);

      // Find created receipt object
      const receiptObj = result.objectChanges?.find(
        (c) => c.type === "created" && c.objectType?.includes("PaymentReceipt"),
      );
      const receiptId = receiptObj && "objectId" in receiptObj ? receiptObj.objectId : "unknown";

      return {
        content: [
          {
            type: "text" as const,
            text: `Payment successful!\n\nAmount: ${formatted}\nRecipient: ${recipient}\nTX Digest: ${digest}\nReceipt ID: ${receiptId}\nNetwork: ${ctx.network}`,
          },
        ],
      };
    },
  );
}
