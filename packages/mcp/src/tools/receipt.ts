import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SuiEvent } from "@mysten/sui/jsonRpc";
import type { SweefiContext } from "../context.js";
import { suiAddress, suiObjectId } from "../utils/format.js";

export function registerReceiptTool(server: McpServer, ctx: SweefiContext) {
  server.registerTool(
    "sweefi_get_receipt",
    {
      title: "Get Receipt",
      description:
        "Fetch a PaymentReceipt or EscrowReceipt by its object ID. " +
        "Returns all receipt fields including amount, payer, recipient, " +
        "timestamp, and token type. Useful for verifying payments and SEAL integration.",
      inputSchema: {
        receiptId: suiObjectId("Receipt"),
      },
    },
    async ({ receiptId }) => {
      const obj = await ctx.suiClient.getObject({
        id: receiptId,
        options: { showContent: true, showType: true },
      });

      if (!obj.data) {
        return {
          content: [{ type: "text" as const, text: `Receipt ${receiptId} not found.` }],
          isError: true,
        };
      }

      const content = obj.data.content;
      if (content?.dataType !== "moveObject") {
        return {
          content: [{ type: "text" as const, text: `Object ${receiptId} is not a Move object.` }],
          isError: true,
        };
      }

      const fields = content.fields as Record<string, unknown>;
      const typeName = obj.data.type ?? "unknown";

      return {
        content: [
          {
            type: "text" as const,
            text: `Receipt: ${receiptId}\nType: ${typeName}\n\n${JSON.stringify(fields, null, 2)}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "sweefi_check_payment",
    {
      title: "Check Payment History",
      description:
        "Query recent payment events for an address. Shows payments made or received, " +
        "including amounts, counterparties, and transaction digests.",
      inputSchema: {
        address: suiAddress("Account"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Number of events to fetch (default 10, max 50)"),
      },
    },
    async ({ address, limit }) => {
      const eventLimit = limit ?? 10;

      // Query PaymentMade events where this address is the payer
      const events = await ctx.suiClient.queryEvents({
        query: {
          MoveEventType: `${ctx.config.packageId}::payment::PaymentMade`,
        },
        limit: eventLimit,
        order: "descending",
      });

      if (events.data.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No payment events found for package ${ctx.config.packageId}. This may mean no payments have been made yet, or the package ID is incorrect.`,
            },
          ],
        };
      }

      // Filter events involving this address
      const relevant = events.data.filter((e: SuiEvent) => {
        const parsed = e.parsedJson as Record<string, unknown> | undefined;
        return parsed?.payer === address || parsed?.recipient === address;
      });

      if (relevant.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No payments found involving ${address} in the last ${eventLimit} payment events.`,
            },
          ],
        };
      }

      const lines = relevant.map((e: SuiEvent) => {
        const p = e.parsedJson as Record<string, unknown>;
        return `TX: ${e.id.txDigest}\n  Amount: ${p.amount}\n  Payer: ${p.payer}\n  Recipient: ${p.recipient}\n  Timestamp: ${e.timestampMs}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Payment history for ${address}:\n\n${lines.join("\n\n")}`,
          },
        ],
      };
    },
  );
}
