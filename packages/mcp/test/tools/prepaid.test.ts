import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrepaidTools, registerPrepaidProviderTools } from "../../src/tools/prepaid.js";
import type { SweefiContext } from "../../src/context.js";

vi.mock("@sweefi/sui/ptb", () => ({
  buildPrepaidDepositTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildPrepaidClaimTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildRequestWithdrawalTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildFinalizeWithdrawalTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildCancelWithdrawalTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildPrepaidTopUpTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildPrepaidAgentCloseTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  UNLIMITED_CALLS: "18446744073709551615",
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
  registerPrepaidTools(server, ctx);
  registerPrepaidProviderTools(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("prepaid tools", () => {
  const makeCtx = (overrides?: Partial<SweefiContext>): SweefiContext => ({
    suiClient: {
      getObject: vi.fn().mockResolvedValue({
        data: {
          content: {
            dataType: "moveObject",
            type: "0xtest::prepaid::PrepaidBalance<0x2::sui::SUI>",
            fields: {
              agent: "0x" + "a".repeat(64),
              provider: "0x" + "b".repeat(64),
              deposited: { fields: { value: "5000000000" } },
              rate_per_call: "1000000",
              claimed_calls: "42",
              max_calls: "18446744073709551615",
              withdrawal_pending: false,
              withdrawal_delay_ms: "300000",
              withdrawal_requested_ms: "0",
              last_claim_ms: "1708012800000",
              fee_micro_pct: "5000",
              fee_recipient: "0x" + "c".repeat(64),
            },
          },
        },
      }),
    } as any,
    signer: null,
    config: { packageId: "0xtest" },
    network: "testnet",
    spendingLimits: { maxPerTx: 0n, maxPerSession: 0n, sessionSpent: 0n },
    ...overrides,
  });

  it("registers all 8 agent-side prepaid tools", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerPrepaidTools(server, makeCtx());
    // If registration threw (e.g. schema conflict), this test would fail
  });

  it("registers provider-side prepaid tools", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerPrepaidProviderTools(server, makeCtx());
  });

  describe("sweefi_prepaid_status handler", () => {
    it("returns formatted status for a valid PrepaidBalance", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_prepaid_status")!;

      const result = await handler({ balanceId: "0x" + "d".repeat(64) });

      const text = result.content[0].text;
      expect(text).toContain("PrepaidBalance Status");
      expect(text).toContain("5000000000 base units");
      expect(text).toContain("Rate per call: 1000000");
      expect(text).toContain("Claimed calls: 42");
      expect(text).toContain("Max calls: unlimited");
      expect(text).toContain("Withdrawal pending: false");
      expect(text).toContain("Fee: 5000 micro-percent");
    });

    it("shows unlimited for u64::MAX max_calls", async () => {
      const ctx = makeCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_prepaid_status")!;

      const result = await handler({ balanceId: "0x" + "d".repeat(64) });
      expect(result.content[0].text).toContain("Max calls: unlimited");
    });

    it("handles missing object gracefully", async () => {
      const ctx = makeCtx({
        suiClient: {
          getObject: vi.fn().mockResolvedValue({ data: null }),
        } as any,
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_prepaid_status")!;

      const result = await handler({ balanceId: "0x" + "d".repeat(64) });
      expect(result.content[0].text).toContain("PrepaidBalance not found");
      expect(result.content[0].text).toContain("may have been consumed");
    });

    it("shows withdrawal finalize-after when withdrawal pending", async () => {
      const requestedMs = "1708000000000";
      const delayMs = "300000"; // 5 min
      const ctx = makeCtx();
      (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          content: {
            dataType: "moveObject",
            type: "0xtest::prepaid::PrepaidBalance<0x2::sui::SUI>",
            fields: {
              agent: "0x" + "a".repeat(64),
              provider: "0x" + "b".repeat(64),
              deposited: { fields: { value: "1000000000" } },
              rate_per_call: "1000000",
              claimed_calls: "10",
              max_calls: "100",
              withdrawal_pending: true,
              withdrawal_delay_ms: delayMs,
              withdrawal_requested_ms: requestedMs,
              last_claim_ms: "0",
              fee_micro_pct: "0",
              fee_recipient: "0x" + "0".repeat(64),
            },
          },
        },
      });

      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_prepaid_status")!;

      const result = await handler({ balanceId: "0x" + "d".repeat(64) });
      const text = result.content[0].text;
      expect(text).toContain("Withdrawal pending: true");
      expect(text).toContain("Finalize after:");
      expect(text).toContain("Max calls: 100");
    });
  });

  describe("sweefi_prepaid_deposit handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx(); // signer: null
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_prepaid_deposit")!;

      await expect(
        handler({
          provider: "0x" + "b".repeat(64),
          amount: "1000000000",
          ratePerCall: "1000000",
          withdrawalDelayMs: "300000",
        }),
      ).rejects.toThrow("Wallet not configured");
    });
  });

  describe("sweefi_prepaid_claim handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeCtx(); // signer: null
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_prepaid_claim")!;

      await expect(
        handler({
          balanceId: "0x" + "d".repeat(64),
          cumulativeCallCount: "100",
        }),
      ).rejects.toThrow("Wallet not configured");
    });
  });
});
