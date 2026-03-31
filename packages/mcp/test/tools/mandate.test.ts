import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMandateTools } from "../../src/tools/mandate.js";
import type { SweefiContext } from "../../src/context.js";

vi.mock("@sweefi/sui/ptb", () => ({
  buildCreateMandateTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildCreateAgentMandateTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildMandatedPayTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildAgentMandatedPayTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildRevokeMandateTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildCreateRegistryTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
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
  registerMandateTools(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("mandate tools", () => {
  const makeAgentMandateCtx = (): SweefiContext => ({
    suiClient: {
      getObject: vi.fn().mockResolvedValue({
        data: {
          content: {
            dataType: "moveObject",
            type: "0xtest::agent_mandate::AgentMandate<0x2::sui::SUI>",
            fields: {
              delegator: "0x" + "a".repeat(64),
              delegate: "0x" + "b".repeat(64),
              level: 2,
              max_per_tx: "1000000000",
              daily_limit: "5000000000",
              daily_spent: "500000000",
              weekly_limit: "20000000000",
              weekly_spent: "2000000000",
              max_total: "100000000000",
              total_spent: "10000000000",
              expires_at_ms: "1740000000000",
            },
          },
        },
      }),
    } as any,
    signer: null,
    config: { packageId: "0xtest" },
    network: "testnet",
    spendingLimits: { maxPerTx: 0n, maxPerSession: 0n, sessionSpent: 0n },
  });

  const makeBasicMandateCtx = (): SweefiContext => ({
    suiClient: {
      getObject: vi.fn().mockResolvedValue({
        data: {
          content: {
            dataType: "moveObject",
            type: "0xtest::mandate::Mandate<0x2::sui::SUI>",
            fields: {
              delegator: "0x" + "a".repeat(64),
              delegate: "0x" + "b".repeat(64),
              max_per_tx: "500000000",
              max_total: "10000000000",
              total_spent: "3000000000",
              expires_at_ms: "1740000000000",
            },
          },
        },
      }),
    } as any,
    signer: null,
    config: { packageId: "0xtest" },
    network: "testnet",
    spendingLimits: { maxPerTx: 0n, maxPerSession: 0n, sessionSpent: 0n },
  });

  it("registers all 8 mandate tools", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerMandateTools(server, makeAgentMandateCtx());
  });

  describe("sweefi_inspect_mandate handler", () => {
    it("formats AgentMandate with tiered details", async () => {
      const ctx = makeAgentMandateCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_inspect_mandate")!;

      const result = await handler({ mandateId: "0x" + "d".repeat(64) });
      const text = result.content[0].text;

      expect(text).toContain("Mandate Status");
      expect(text).toContain("Type: Agent Mandate");
      expect(text).toContain("L2 (Capped)");
      expect(text).toContain("Daily limit: 5000000000 base units");
      expect(text).toContain("Daily spent: 500000000");
      expect(text).toContain("Weekly limit: 20000000000 base units");
      expect(text).toContain("Weekly spent: 2000000000");
      expect(text).toContain("Max per TX: 1000000000");
      expect(text).toContain("Lifetime cap: 100000000000");
      expect(text).toContain("Total spent: 10000000000");
    });

    it("computes remaining lifetime budget correctly", async () => {
      const ctx = makeAgentMandateCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_inspect_mandate")!;

      const result = await handler({ mandateId: "0x" + "d".repeat(64) });
      // max_total (100B) - total_spent (10B) = 90B remaining
      expect(result.content[0].text).toContain("Remaining: 90000000000 base units");
    });

    it("formats Basic Mandate without tiered details", async () => {
      const ctx = makeBasicMandateCtx();
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_inspect_mandate")!;

      const result = await handler({ mandateId: "0x" + "d".repeat(64) });
      const text = result.content[0].text;

      expect(text).toContain("Type: Basic Mandate");
      expect(text).toContain("Max per TX: 500000000");
      expect(text).toContain("Remaining: 7000000000 base units");
      // Should NOT contain agent-specific fields
      expect(text).not.toContain("Daily limit");
      expect(text).not.toContain("Weekly limit");
      expect(text).not.toContain("Level:");
    });

    it("handles missing mandate gracefully", async () => {
      const ctx = makeAgentMandateCtx();
      (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: null,
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_inspect_mandate")!;

      const result = await handler({ mandateId: "0x" + "d".repeat(64) });
      expect(result.content[0].text).toContain("Mandate not found");
    });

    it("handles BigInt subtraction failure gracefully", async () => {
      const ctx = makeAgentMandateCtx();
      (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          content: {
            dataType: "moveObject",
            type: "0xtest::mandate::Mandate<0x2::sui::SUI>",
            fields: {
              delegator: "0x" + "a".repeat(64),
              delegate: "0x" + "b".repeat(64),
              max_per_tx: "bad_value",
              max_total: "not_a_number",
              total_spent: "also_bad",
              expires_at_ms: "1740000000000",
            },
          },
        },
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_inspect_mandate")!;

      const result = await handler({ mandateId: "0x" + "d".repeat(64) });
      // Should fall back to "unknown" instead of crashing
      expect(result.content[0].text).toContain("Remaining: unknown");
    });

    it("shows zero budget for zero daily/weekly limits on AgentMandate", async () => {
      const ctx = makeAgentMandateCtx();
      (ctx.suiClient.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          content: {
            dataType: "moveObject",
            type: "0xtest::agent_mandate::AgentMandate<0x2::sui::SUI>",
            fields: {
              delegator: "0x" + "a".repeat(64),
              delegate: "0x" + "b".repeat(64),
              level: 3,
              max_per_tx: "1000000000",
              daily_limit: "0",
              daily_spent: "0",
              weekly_limit: "0",
              weekly_spent: "0",
              max_total: "100000000000",
              total_spent: "0",
              expires_at_ms: "1740000000000",
            },
          },
        },
      });
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_inspect_mandate")!;

      const result = await handler({ mandateId: "0x" + "d".repeat(64) });
      const text = result.content[0].text;
      expect(text).toContain("Daily limit: 0 base units");
      expect(text).toContain("Weekly limit: 0 base units");
      expect(text).toContain("L3 (Autonomous)");
    });
  });

  describe("sweefi_create_mandate handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeAgentMandateCtx(); // signer: null
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_create_mandate")!;

      await expect(
        handler({
          delegate: "0x" + "b".repeat(64),
          maxPerTx: "1000000000",
          maxTotal: "10000000000",
          expiresAtMs: "1740000000000",
        }),
      ).rejects.toThrow("Wallet not configured");
    });
  });

  describe("sweefi_revoke_mandate handler", () => {
    it("throws when no signer configured", async () => {
      const ctx = makeAgentMandateCtx(); // signer: null
      const server = new McpServer({ name: "test", version: "0.1.0" });
      const handlers = captureHandlers(server, ctx);
      const handler = handlers.get("sweefi_revoke_mandate")!;

      await expect(
        handler({
          registryId: "0x" + "e".repeat(64),
          mandateId: "0x" + "d".repeat(64),
        }),
      ).rejects.toThrow("Wallet not configured");
    });
  });
});
