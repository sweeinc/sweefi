import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SuiObjectChange } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { PaymentContract, createBuilderConfig } from "@sweefi/sui";
import type { SweefiContext } from "../context.js";
import { requireSigner, checkSpendingLimit, recordSpend } from "../context.js";
import { resolveCoinType, formatBalance, parseAmount, assertTxSuccess, ZERO_ADDRESS, suiAddress, suiObjectId, optionalSuiAddress } from "../utils/format.js";

export function registerInvoiceTools(server: McpServer, ctx: SweefiContext) {
  const payment = new PaymentContract(createBuilderConfig({
    packageId: ctx.config.packageId,
    protocolState: ctx.config.protocolStateId,
  }));

  server.registerTool(
    "sweefi_create_invoice",
    {
      title: "Create Invoice",
      description:
        "Create a payment invoice NFT on Sui. The invoice specifies an expected amount " +
        "and recipient. When paid, the invoice is consumed on-chain (replay protection). " +
        "Optionally send the invoice to a specific address. Requires a configured wallet.",
      inputSchema: {
        recipient: suiAddress("Recipient"),
        amount: z.string().describe("Expected payment amount in base units"),
        feeMicroPercent: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .optional()
          .describe("Fee in micro-percent (0-1000000, where 1000000 = 100%). Default 0."),
        feeRecipient: optionalSuiAddress("Fee recipient"),
        sendTo: optionalSuiAddress("Invoice destination"),
      },
    },
    async ({ recipient, amount, feeMicroPercent, feeRecipient, sendTo }) => {
      const signer = requireSigner(ctx);

      const tx = new Transaction();
      payment.createInvoice({
        sender: signer.toSuiAddress(),
        recipient,
        expectedAmount: parseAmount(amount),
        feeMicroPercent: feeMicroPercent ?? 0,
        feeRecipient: feeRecipient ?? ZERO_ADDRESS,
        sendTo,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);

      const invoiceObj = result.objectChanges?.find(
        (c: SuiObjectChange) => c.type === "created" && c.objectType?.includes("Invoice"),
      );
      const invoiceId = invoiceObj && "objectId" in invoiceObj ? invoiceObj.objectId : "unknown";

      return {
        content: [
          {
            type: "text" as const,
            text: `Invoice created!\n\nInvoice ID: ${invoiceId}\nExpected Amount: ${amount}\nRecipient: ${recipient}\nTX Digest: ${result.digest}\nNetwork: ${ctx.network}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "sweefi_pay_invoice",
    {
      title: "Pay Invoice",
      description:
        "Pay an existing invoice on Sui. The invoice NFT is consumed on-chain " +
        "(prevents replay). A PaymentReceipt is minted and sent to the payer. " +
        "Requires a configured wallet.",
      inputSchema: {
        invoiceId: suiObjectId("Invoice"),
        amount: z.string().describe("Amount to send (must be >= invoice expected amount)"),
        coinType: z
          .string()
          .optional()
          .describe('Token to pay with. Defaults to "SUI".'),
      },
    },
    async ({ invoiceId, amount, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType, ctx.network);
      const amountBigint = parseAmount(amount);
      checkSpendingLimit(ctx, amountBigint);

      const tx = new Transaction();
      payment.payInvoice({
        coinType: resolvedType,
        sender: signer.toSuiAddress(),
        invoiceId,
        amount: amountBigint,
      })(tx);

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);
      recordSpend(ctx, amountBigint);

      const receiptObj = result.objectChanges?.find(
        (c: SuiObjectChange) => c.type === "created" && c.objectType?.includes("PaymentReceipt"),
      );
      const receiptId = receiptObj && "objectId" in receiptObj ? receiptObj.objectId : "unknown";
      const formatted = formatBalance(amount, resolvedType);

      return {
        content: [
          {
            type: "text" as const,
            text: `Invoice paid!\n\nInvoice: ${invoiceId}\nAmount: ${formatted}\nReceipt ID: ${receiptId}\nTX Digest: ${result.digest}\nNetwork: ${ctx.network}`,
          },
        ],
      };
    },
  );
}
