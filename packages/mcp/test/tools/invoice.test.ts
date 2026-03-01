import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerInvoiceTools } from "../../src/tools/invoice.js";
import type { SweefiContext } from "../../src/context.js";

vi.mock("@sweefi/sui/ptb", () => ({
  buildCreateInvoiceTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildPayInvoiceTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
}));

function captureHandlers(server: McpServer, ctx: SweefiContext) {
  const handlers = new Map<string, Function>();
  const orig = server.registerTool.bind(server);
  const spy = vi.spyOn(server, "registerTool").mockImplementation(
    (name: string, config: any, cb: any) => {
      handlers.set(name, cb);
      return orig(name, config, cb);
    },
  );
  registerInvoiceTools(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("invoice tools", () => {
  const makeCtx = (overrides?: Partial<SweefiContext>): SweefiContext => ({
    suiClient: {
      signAndExecuteTransaction: vi.fn().mockResolvedValue({
        digest: "test_digest_invoice",
        effects: { status: { status: "success" } },
        objectChanges: [
          {
            type: "created",
            objectType: "0xtest::invoice::Invoice",
            objectId: "0xinvoice789",
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

  it("registers both create and pay invoice tools", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerInvoiceTools(server, makeCtx());
  });

  describe("sweefi_create_invoice handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_create_invoice")!;

      await expect(
        handler({
          recipient: "0x" + "b".repeat(64),
          amount: "1000000000",
        }),
      ).rejects.toThrow("Wallet not configured");
    });

    it("returns formatted output with invoice ID on success", async () => {
      const mockSigner = {
        toSuiAddress: () => "0x" + "f".repeat(64),
      };
      const ctx = makeCtx({ signer: mockSigner as any });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_create_invoice")!;

      const result = await handler({
        recipient: "0x" + "b".repeat(64),
        amount: "1000000000",
      });
      const text = result.content[0].text;

      expect(text).toContain("Invoice created!");
      expect(text).toContain("Invoice ID: 0xinvoice789");
      expect(text).toContain("test_digest_invoice");
      expect(text).toContain("testnet");
    });
  });

  describe("sweefi_pay_invoice handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_pay_invoice")!;

      await expect(
        handler({
          invoiceId: "0x" + "d".repeat(64),
          amount: "1000000000",
        }),
      ).rejects.toThrow("Wallet not configured");
    });

    it("returns formatted output with receipt on success", async () => {
      const mockSigner = {
        toSuiAddress: () => "0x" + "f".repeat(64),
      };
      const ctx = makeCtx({
        signer: mockSigner as any,
        suiClient: {
          signAndExecuteTransaction: vi.fn().mockResolvedValue({
            digest: "test_digest_pay_invoice",
            effects: { status: { status: "success" } },
            objectChanges: [
              {
                type: "created",
                objectType: "0xtest::payment::PaymentReceipt",
                objectId: "0xreceipt_inv",
              },
            ],
          }),
        } as any,
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_pay_invoice")!;

      const result = await handler({
        invoiceId: "0x" + "d".repeat(64),
        amount: "1000000000",
      });
      const text = result.content[0].text;

      expect(text).toContain("Invoice paid!");
      expect(text).toContain("Receipt ID: 0xreceipt_inv");
      expect(text).toContain("test_digest_pay_invoice");
    });
  });
});
