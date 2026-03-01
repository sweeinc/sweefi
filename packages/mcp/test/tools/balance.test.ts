import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBalanceTool } from "../../src/tools/balance.js";
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
  registerBalanceTool(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("sweefi_check_balance", () => {
  const makeCtx = (overrides?: Partial<SweefiContext>): SweefiContext => ({
    suiClient: {
      getBalance: vi.fn().mockResolvedValue({
        totalBalance: "1000000000",
        coinObjectCount: 3,
      }),
    } as any,
    signer: null,
    config: { packageId: "0xtest" },
    network: "testnet",
    spendingLimits: { maxPerTx: 0n, maxPerSession: 0n, sessionSpent: 0n },
    ...overrides,
  });

  it("registers the tool on the server", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerBalanceTool(server, makeCtx());
  });

  it("returns formatted balance for a valid address", async () => {
    const ctx = makeCtx();
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const handlers = captureHandlers(server, ctx);
    const handler = handlers.get("sweefi_check_balance")!;

    const result = await handler({ address: "0x" + "a".repeat(64) });
    const text = result.content[0].text;

    expect(text).toContain("Balance for 0x" + "a".repeat(64));
    expect(text).toContain("1000000000");
    expect(text).toContain("3 coin objects");
  });

  it("calls getBalance with correct owner and coin type", async () => {
    const ctx = makeCtx();
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const handlers = captureHandlers(server, ctx);
    const handler = handlers.get("sweefi_check_balance")!;

    await handler({ address: "0x" + "a".repeat(64) });

    const getBalance = ctx.suiClient.getBalance as ReturnType<typeof vi.fn>;
    expect(getBalance).toHaveBeenCalledOnce();
    expect(getBalance).toHaveBeenCalledWith({
      owner: "0x" + "a".repeat(64),
      coinType: "0x2::sui::SUI",
    });
  });

  it("works without a signer (read-only tool)", async () => {
    const ctx = makeCtx(); // signer: null — should still work
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const handlers = captureHandlers(server, ctx);
    const handler = handlers.get("sweefi_check_balance")!;

    // Should not throw — balance is a read-only tool
    const result = await handler({ address: "0x" + "a".repeat(64) });
    expect(result.content[0].text).toContain("Balance for");
  });
});
