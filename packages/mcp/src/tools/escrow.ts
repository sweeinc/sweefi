import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildCreateEscrowTx,
  buildReleaseEscrowTx,
  buildRefundEscrowTx,
  buildDisputeEscrowTx,
} from "@sweepay/sui/ptb";
import type { SweepayContext } from "../context.js";
import { requireSigner, checkSpendingLimit, recordSpend } from "../context.js";
import { resolveCoinType, formatBalance, parseAmount, assertTxSuccess, ZERO_ADDRESS, suiAddress, suiObjectId, optionalSuiAddress } from "../utils/format.js";

export function registerEscrowTools(server: McpServer, ctx: SweepayContext) {
  // ── Create Escrow ──────────────────────────────────────────
  server.registerTool(
    "sweepay_create_escrow",
    {
      title: "Create Escrow",
      description:
        "Create a time-locked escrow on Sui. The buyer deposits funds into a shared " +
        "escrow object. The seller delivers, buyer releases funds. If delivery fails, " +
        "funds auto-refund after the deadline (permissionless — anyone can trigger it). " +
        "An arbiter can resolve disputes before the deadline. " +
        "SEAL integration: the Escrow ID serves as the encryption access condition — " +
        "seller encrypts deliverables, buyer decrypts after release. " +
        "Requires a configured wallet.",
      inputSchema: {
        seller: suiAddress("Seller"),
        arbiter: suiAddress("Arbiter"),
        amount: z.string().describe("Deposit amount in base units"),
        deadlineMs: z
          .string()
          .describe(
            "Deadline as Unix timestamp in milliseconds. " +
            "After this time, anyone can trigger a refund.",
          ),
        coinType: z.string().optional().describe('Token type. Defaults to "SUI".'),
        memo: z.string().optional().describe("Description of what's being escrowed"),
        feeBps: z
          .number()
          .int()
          .min(0)
          .max(10000)
          .optional()
          .describe("Fee in basis points, charged on release only (default 0)"),
        feeRecipient: optionalSuiAddress("Fee recipient"),
      },
    },
    async ({ seller, arbiter, amount, deadlineMs, coinType, memo, feeBps, feeRecipient }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType);
      const depositAmount = parseAmount(amount);
      checkSpendingLimit(ctx, depositAmount);

      const tx = buildCreateEscrowTx(ctx.config, {
        coinType: resolvedType,
        sender: signer.toSuiAddress(),
        seller,
        arbiter,
        depositAmount,
        deadlineMs: parseAmount(deadlineMs, "deadlineMs"),
        feeBps: feeBps ?? 0,
        feeRecipient: feeRecipient ?? ZERO_ADDRESS,
        memo,
      });

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);
      recordSpend(ctx, depositAmount);

      const escrowObj = result.objectChanges?.find(
        (c) => c.type === "created" && c.objectType?.includes("Escrow"),
      );
      const escrowId = escrowObj && "objectId" in escrowObj ? escrowObj.objectId : "unknown";
      const formatted = formatBalance(amount, resolvedType);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Escrow created!\n\n` +
              `Escrow ID: ${escrowId}\n` +
              `Deposit: ${formatted}\n` +
              `Seller: ${seller}\n` +
              `Arbiter: ${arbiter}\n` +
              `Deadline: ${new Date(Number(deadlineMs)).toISOString()}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `SEAL anchor: Use Escrow ID (${escrowId}) as the encryption access condition. ` +
              `Seller can encrypt deliverables now. Buyer decrypts after release.`,
          },
        ],
      };
    },
  );

  // ── Release Escrow ─────────────────────────────────────────
  server.registerTool(
    "sweepay_release_escrow",
    {
      title: "Release Escrow Funds",
      description:
        "Release escrowed funds to the seller. Only the buyer can release (if ACTIVE state) " +
        "or the arbiter can release (if DISPUTED state). Fee is charged on release. " +
        "The buyer receives an EscrowReceipt — usable as a SEAL decryption credential. " +
        "The Escrow object is consumed (deleted). " +
        "Requires a configured wallet.",
      inputSchema: {
        escrowId: suiObjectId("Escrow"),
        coinType: z.string().optional().describe('Token type of the escrow. Defaults to "SUI".'),
      },
    },
    async ({ escrowId, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType);

      const tx = buildReleaseEscrowTx(ctx.config, {
        coinType: resolvedType,
        escrowId,
        sender: signer.toSuiAddress(),
      });

      const result = await ctx.suiClient.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });
      assertTxSuccess(result);

      const receiptObj = result.objectChanges?.find(
        (c) => c.type === "created" && c.objectType?.includes("EscrowReceipt"),
      );
      const receiptId = receiptObj && "objectId" in receiptObj ? receiptObj.objectId : "unknown";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Escrow released!\n\n` +
              `Escrow: ${escrowId}\n` +
              `EscrowReceipt: ${receiptId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `Funds sent to seller (minus fee). Buyer received EscrowReceipt.\n` +
              `SEAL: Receipt ID (${receiptId}) is the decryption credential.`,
          },
        ],
      };
    },
  );

  // ── Refund Escrow ──────────────────────────────────────────
  server.registerTool(
    "sweepay_refund_escrow",
    {
      title: "Refund Escrow",
      description:
        "Refund escrowed funds to the buyer. Who can call:\n" +
        "- Anyone: after the deadline (permissionless timeout — prevents fund lockup)\n" +
        "- Arbiter: if DISPUTED state (before deadline)\n" +
        "No fee is charged on refunds. The Escrow object is consumed. " +
        "Requires a configured wallet.",
      inputSchema: {
        escrowId: suiObjectId("Escrow"),
        coinType: z.string().optional().describe('Token type of the escrow. Defaults to "SUI".'),
      },
    },
    async ({ escrowId, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType);

      const tx = buildRefundEscrowTx(ctx.config, {
        coinType: resolvedType,
        escrowId,
        sender: signer.toSuiAddress(),
      });

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
              `Escrow refunded!\n\n` +
              `Escrow: ${escrowId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `Full deposit returned to buyer. No fee charged on refund.`,
          },
        ],
      };
    },
  );

  // ── Dispute Escrow ─────────────────────────────────────────
  server.registerTool(
    "sweepay_dispute_escrow",
    {
      title: "Dispute Escrow",
      description:
        "Raise a dispute on an active escrow. Either the buyer or seller can dispute. " +
        "Once disputed, only the arbiter can release or refund (or the deadline auto-refund " +
        "still triggers for anyone). The escrow moves from ACTIVE to DISPUTED state. " +
        "The Escrow object is mutated, not consumed. " +
        "Requires a configured wallet.",
      inputSchema: {
        escrowId: suiObjectId("Escrow"),
        coinType: z.string().optional().describe('Token type of the escrow. Defaults to "SUI".'),
      },
    },
    async ({ escrowId, coinType }) => {
      const signer = requireSigner(ctx);
      const resolvedType = resolveCoinType(coinType);

      const tx = buildDisputeEscrowTx(ctx.config, {
        coinType: resolvedType,
        escrowId,
        sender: signer.toSuiAddress(),
      });

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
              `Escrow disputed!\n\n` +
              `Escrow: ${escrowId}\n` +
              `TX Digest: ${result.digest}\n` +
              `Network: ${ctx.network}\n\n` +
              `State: DISPUTED. Only the arbiter can now release or refund.\n` +
              `If the arbiter doesn't act, the deadline auto-refund still protects the buyer.`,
          },
        ],
      };
    },
  );
}
