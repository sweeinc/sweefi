import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdminTools } from "../../src/tools/admin.js";
import type { SweefiContext } from "../../src/context.js";

vi.mock("@sweefi/sui/ptb", () => ({
  buildAdminPauseTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildAdminUnpauseTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildBurnAdminCapTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
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
  registerAdminTools(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("admin tools", () => {
  const ADMIN_CAP_ID = "0x" + "a".repeat(64);
  const PROTOCOL_STATE_ID = "0x" + "b".repeat(64);
  const SENDER_ADDRESS = "0x" + "c".repeat(64);
  const TX_DIGEST = "ABC123TestDigest";

  const makeCtx = (overrides?: Partial<SweefiContext>): SweefiContext => ({
    suiClient: {
      getObject: vi.fn().mockResolvedValue({
        data: {
          content: {
            dataType: "moveObject",
            type: "0xtest::admin::ProtocolState",
            fields: {
              paused: false,
            },
          },
        },
      }),
      signAndExecuteTransaction: vi.fn().mockResolvedValue({
        digest: TX_DIGEST,
        effects: { status: { status: "success" } },
      }),
    } as any,
    signer: null,
    config: { packageId: "0xtest", protocolStateId: PROTOCOL_STATE_ID },
    network: "testnet",
    spendingLimits: { maxPerTx: 0n, maxPerSession: 0n, sessionSpent: 0n },
    ...overrides,
  });

  const makeSignerCtx = (overrides?: Partial<SweefiContext>): SweefiContext => {
    const mockSigner = {
      toSuiAddress: vi.fn().mockReturnValue(SENDER_ADDRESS),
    };
    return makeCtx({
      signer: mockSigner as any,
      ...overrides,
    });
  };

  // ─── Tool registration ───────────────────────────────────────

  it("registers all 4 admin tools without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerAdminTools(server, makeCtx());
    // If registration threw (e.g. schema conflict), this test would fail
  });

  // ─── sweefi_protocol_status ──────────────────────────────────

  describe("sweefi_protocol_status handler", () => {
    it("returns error when protocolStateId is not configured", async () => {
      const ctx = makeCtx({
        config: { packageId: "0xtest" }, // no protocolStateId
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_protocol_status")!;

      const result = await handler({});
      const text = result.content[0].text;
      expect(text).toContain("ProtocolState object ID not configured");
      expect(text).toContain("SUI_PROTOCOL_STATE_ID");
    });

    it("formats ACTIVE protocol state correctly", async () => {
      const ctx = makeCtx(); // paused: false by default
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_protocol_status")!;

      const result = await handler({});
      const text = result.content[0].text;
      expect(text).toContain("Protocol Status: ACTIVE");
      expect(text).toContain(`ProtocolState ID: ${PROTOCOL_STATE_ID}`);
      expect(text).toContain("Network: testnet");
      expect(text).toContain("All operations are enabled.");
    });

    it("formats PAUSED protocol state correctly", async () => {
      const ctx = makeCtx();
      (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          content: {
            dataType: "moveObject",
            type: "0xtest::admin::ProtocolState",
            fields: {
              paused: true,
            },
          },
        },
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_protocol_status")!;

      const result = await handler({});
      const text = result.content[0].text;
      expect(text).toContain("Protocol Status: PAUSED");
      expect(text).toContain(`ProtocolState ID: ${PROTOCOL_STATE_ID}`);
      expect(text).toContain("Network: testnet");
      expect(text).toContain("New stream/escrow creation is blocked");
      expect(text).toContain("withdrawals are unaffected");
    });

    it("handles missing/non-existent object gracefully", async () => {
      const ctx = makeCtx();
      (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: null,
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_protocol_status")!;

      const result = await handler({});
      const text = result.content[0].text;
      expect(text).toContain("Failed to fetch ProtocolState");
      expect(text).toContain(PROTOCOL_STATE_ID);
      expect(text).toContain("testnet");
    });

    it("handles object with non-moveObject dataType gracefully", async () => {
      const ctx = makeCtx();
      (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          content: {
            dataType: "package",
          },
        },
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_protocol_status")!;

      const result = await handler({});
      const text = result.content[0].text;
      expect(text).toContain("Failed to fetch ProtocolState");
    });

    it("does not require a signer (read-only tool)", async () => {
      // signer: null should work fine for status check
      const ctx = makeCtx(); // signer is null by default
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_protocol_status")!;

      // Should not throw — read-only tool works without wallet
      const result = await handler({});
      expect(result.content[0].text).toContain("Protocol Status:");
    });
  });

  // ─── sweefi_pause_protocol ───────────────────────────────────

  describe("sweefi_pause_protocol handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx(); // signer: null
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_pause_protocol")!;

      await expect(
        handler({ adminCapId: ADMIN_CAP_ID }),
      ).rejects.toThrow("Wallet not configured");
    });

    it("returns success message with TX digest on success", async () => {
      const ctx = makeSignerCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_pause_protocol")!;

      const result = await handler({ adminCapId: ADMIN_CAP_ID });
      const text = result.content[0].text;
      expect(text).toContain("Protocol PAUSED successfully");
      expect(text).toContain(`TX Digest: ${TX_DIGEST}`);
      expect(text).toContain("Network: testnet");
      expect(text).toContain("sweefi_unpause_protocol");
    });

    it("throws on transaction failure", async () => {
      const ctx = makeSignerCtx();
      (ctx.suiClient.signAndExecuteTransaction as ReturnType<typeof vi.fn>).mockResolvedValue({
        digest: TX_DIGEST,
        effects: {
          status: {
            status: "failure",
            error: "MoveAbort(address, 500)",
          },
        },
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_pause_protocol")!;

      await expect(
        handler({ adminCapId: ADMIN_CAP_ID }),
      ).rejects.toThrow();
    });
  });

  // ─── sweefi_unpause_protocol ─────────────────────────────────

  describe("sweefi_unpause_protocol handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx(); // signer: null
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_unpause_protocol")!;

      await expect(
        handler({ adminCapId: ADMIN_CAP_ID }),
      ).rejects.toThrow("Wallet not configured");
    });

    it("returns success message with TX digest on success", async () => {
      const ctx = makeSignerCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_unpause_protocol")!;

      const result = await handler({ adminCapId: ADMIN_CAP_ID });
      const text = result.content[0].text;
      expect(text).toContain("Protocol UNPAUSED successfully");
      expect(text).toContain(`TX Digest: ${TX_DIGEST}`);
      expect(text).toContain("Network: testnet");
      expect(text).toContain("All operations are now enabled");
    });

    it("throws on transaction failure", async () => {
      const ctx = makeSignerCtx();
      (ctx.suiClient.signAndExecuteTransaction as ReturnType<typeof vi.fn>).mockResolvedValue({
        digest: TX_DIGEST,
        effects: {
          status: {
            status: "failure",
            error: "MoveAbort(address, 501)",
          },
        },
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_unpause_protocol")!;

      await expect(
        handler({ adminCapId: ADMIN_CAP_ID }),
      ).rejects.toThrow();
    });
  });

  // ─── sweefi_burn_admin_cap ───────────────────────────────────

  describe("sweefi_burn_admin_cap handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx(); // signer: null
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_burn_admin_cap")!;

      await expect(
        handler({ adminCapId: ADMIN_CAP_ID }),
      ).rejects.toThrow("Wallet not configured");
    });

    it("returns irreversible burn confirmation with TX digest on success", async () => {
      const ctx = makeSignerCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_burn_admin_cap")!;

      const result = await handler({ adminCapId: ADMIN_CAP_ID });
      const text = result.content[0].text;
      expect(text).toContain("AdminCap BURNED");
      expect(text).toContain("irreversible");
      expect(text).toContain(`TX Digest: ${TX_DIGEST}`);
      expect(text).toContain("Network: testnet");
      expect(text).toContain("fully trustless");
      expect(text).toContain("no one can pause or unpause");
    });

    it("throws on transaction failure", async () => {
      const ctx = makeSignerCtx();
      (ctx.suiClient.signAndExecuteTransaction as ReturnType<typeof vi.fn>).mockResolvedValue({
        digest: TX_DIGEST,
        effects: {
          status: {
            status: "failure",
            error: "Some unexpected error",
          },
        },
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_burn_admin_cap")!;

      await expect(
        handler({ adminCapId: ADMIN_CAP_ID }),
      ).rejects.toThrow("TX_FAILED");
    });

    it("calls signAndExecuteTransaction with correct options", async () => {
      const ctx = makeSignerCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_burn_admin_cap")!;

      await handler({ adminCapId: ADMIN_CAP_ID });

      expect(ctx.suiClient.signAndExecuteTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          signer: ctx.signer,
          options: { showEffects: true },
        }),
      );
    });
  });
});
