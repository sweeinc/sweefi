import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReceiptTool } from "../../src/tools/receipt.js";
import type { SweefiContext } from "../../src/context.js";

function captureHandlers(server: McpServer, ctx: SweefiContext) {
  const handlers = new Map<string, Function>();
  const orig = server.registerTool.bind(server);
  const spy = vi.spyOn(server, "registerTool").mockImplementation(
    (name: string, config: any, cb: any) => {
      handlers.set(name, cb);
      return orig(name, config, cb);
    },
  );
  registerReceiptTool(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("receipt tools", () => {
  const makeCtx = (overrides?: Partial<SweefiContext>): SweefiContext => ({
    suiClient: {
      getObject: vi.fn().mockResolvedValue({
        data: {
          type: "0xtest::payment::PaymentReceipt<0x2::sui::SUI>",
          content: {
            dataType: "moveObject",
            fields: {
              payer: "0x" + "a".repeat(64),
              recipient: "0x" + "b".repeat(64),
              amount: "1000000000",
            },
          },
        },
      }),
      queryEvents: vi.fn().mockResolvedValue({
        data: [
          {
            id: { txDigest: "tx_digest_1" },
            parsedJson: {
              payer: "0x" + "a".repeat(64),
              recipient: "0x" + "b".repeat(64),
              amount: "1000000000",
            },
            timestampMs: "1708012800000",
          },
        ],
      }),
    } as any,
    signer: null,
    config: { packageId: "0xtest" },
    network: "testnet",
    spendingLimits: { maxPerTx: 0n, maxPerSession: 0n, sessionSpent: 0n },
    ...overrides,
  });

  it("registers both get_receipt and check_payment tools", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerReceiptTool(server, makeCtx());
  });

  describe("sweefi_get_receipt handler", () => {
    it("returns formatted receipt for a valid object", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_get_receipt")!;

      const result = await handler({ receiptId: "0x" + "d".repeat(64) });
      const text = result.content[0].text;

      expect(text).toContain("Receipt:");
      expect(text).toContain("0x" + "d".repeat(64));
      expect(text).toContain("PaymentReceipt");
      expect(text).toContain("1000000000");
    });

    it("returns error for missing receipt", async () => {
      const ctx = makeCtx({
        suiClient: {
          getObject: vi.fn().mockResolvedValue({ data: null }),
          queryEvents: vi.fn(),
        } as any,
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_get_receipt")!;

      const result = await handler({ receiptId: "0x" + "d".repeat(64) });
      expect(result.content[0].text).toContain("not found");
      expect(result.isError).toBe(true);
    });

    it("returns error for non-Move object", async () => {
      const ctx = makeCtx({
        suiClient: {
          getObject: vi.fn().mockResolvedValue({
            data: {
              content: { dataType: "package" },
            },
          }),
          queryEvents: vi.fn(),
        } as any,
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_get_receipt")!;

      const result = await handler({ receiptId: "0x" + "d".repeat(64) });
      expect(result.content[0].text).toContain("not a Move object");
      expect(result.isError).toBe(true);
    });
  });

  describe("sweefi_check_payment handler", () => {
    it("returns payment history for matching address", async () => {
      const addr = "0x" + "a".repeat(64);
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_check_payment")!;

      const result = await handler({ address: addr });
      const text = result.content[0].text;

      expect(text).toContain("Payment history for");
      expect(text).toContain("tx_digest_1");
      expect(text).toContain("1000000000");
    });

    it("returns 'no events' when query returns empty", async () => {
      const ctx = makeCtx({
        suiClient: {
          getObject: vi.fn(),
          queryEvents: vi.fn().mockResolvedValue({ data: [] }),
        } as any,
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_check_payment")!;

      const result = await handler({ address: "0x" + "a".repeat(64) });
      expect(result.content[0].text).toContain("No payment events found");
    });

    it("returns 'no payments' when events exist but none match address", async () => {
      const ctx = makeCtx({
        suiClient: {
          getObject: vi.fn(),
          queryEvents: vi.fn().mockResolvedValue({
            data: [
              {
                id: { txDigest: "tx_other" },
                parsedJson: {
                  payer: "0x" + "c".repeat(64),
                  recipient: "0x" + "d".repeat(64),
                  amount: "500",
                },
                timestampMs: "1708012800000",
              },
            ],
          }),
        } as any,
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_check_payment")!;

      const result = await handler({ address: "0x" + "a".repeat(64) });
      expect(result.content[0].text).toContain("No payments found involving");
    });
  });
});
