import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStreamTools } from "../../src/tools/stream.js";
import type { SweefiContext } from "../../src/context.js";

vi.mock("@sweefi/sui/ptb", () => ({
  buildCreateStreamTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildCreateStreamWithTimeoutTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildCloseTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildRecipientCloseTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
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
  registerStreamTools(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("stream tools", () => {
  const makeCtx = (overrides?: Partial<SweefiContext>): SweefiContext => ({
    suiClient: {
      signAndExecuteTransaction: vi.fn().mockResolvedValue({
        digest: "test_digest_stream",
        effects: { status: { status: "success" } },
        objectChanges: [
          {
            type: "created",
            objectType: "0xtest::streaming::StreamingMeter<0x2::sui::SUI>",
            objectId: "0xmeter123",
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

  it("registers start, start_with_timeout, stop, and recipient_close tools", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerStreamTools(server, makeCtx());
  });

  describe("sweefi_start_stream handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_start_stream")!;

      await expect(
        handler({
          recipient: "0x" + "a".repeat(64),
          depositAmount: "1000000000",
          ratePerSecond: "1000000",
        }),
      ).rejects.toThrow("Wallet not configured");
    });
  });

  describe("sweefi_start_stream_with_timeout handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_start_stream_with_timeout")!;

      await expect(
        handler({
          recipient: "0x" + "a".repeat(64),
          depositAmount: "1000000000",
          ratePerSecond: "1000000",
          recipientCloseTimeoutMs: "86400000",
        }),
      ).rejects.toThrow("Wallet not configured");
    });
  });

  describe("sweefi_stop_stream handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_stop_stream")!;

      await expect(
        handler({ meterId: "0x" + "d".repeat(64) }),
      ).rejects.toThrow("Wallet not configured");
    });
  });

  describe("sweefi_recipient_close_stream handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_recipient_close_stream")!;

      await expect(
        handler({ meterId: "0x" + "d".repeat(64) }),
      ).rejects.toThrow("Wallet not configured");
    });
  });
});
