import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEscrowTools } from "../../src/tools/escrow.js";
import type { SweefiContext } from "../../src/context.js";

vi.mock("@sweefi/sui/ptb", () => ({
  buildCreateEscrowTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildReleaseEscrowTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildRefundEscrowTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildDisputeEscrowTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
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
  registerEscrowTools(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("escrow tools", () => {
  const makeCtx = (overrides?: Partial<SweefiContext>): SweefiContext => ({
    suiClient: {
      signAndExecuteTransaction: vi.fn().mockResolvedValue({
        digest: "test_digest_escrow",
        effects: { status: { status: "success" } },
        objectChanges: [
          {
            type: "created",
            objectType: "0xtest::escrow::Escrow<0x2::sui::SUI>",
            objectId: "0xescrow123",
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

  it("registers all 4 escrow tools without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerEscrowTools(server, makeCtx());
  });

  describe("sweefi_create_escrow handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_create_escrow")!;

      await expect(
        handler({
          seller: "0x" + "a".repeat(64),
          arbiter: "0x" + "b".repeat(64),
          amount: "1000000000",
          deadlineMs: "1740000000000",
        }),
      ).rejects.toThrow("Wallet not configured");
    });
  });

  describe("sweefi_release_escrow handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_release_escrow")!;

      await expect(
        handler({ escrowId: "0x" + "d".repeat(64) }),
      ).rejects.toThrow("Wallet not configured");
    });
  });

  describe("sweefi_refund_escrow handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_refund_escrow")!;

      await expect(
        handler({ escrowId: "0x" + "d".repeat(64) }),
      ).rejects.toThrow("Wallet not configured");
    });
  });

  describe("sweefi_dispute_escrow handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_dispute_escrow")!;

      await expect(
        handler({ escrowId: "0x" + "d".repeat(64) }),
      ).rejects.toThrow("Wallet not configured");
    });
  });
});
