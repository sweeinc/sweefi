import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSupportedTool } from "../../src/tools/supported.js";
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
  registerSupportedTool(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("sweefi_supported_tokens", () => {
  const makeCtx = (): SweefiContext => ({
    suiClient: {} as any,
    signer: null,
    config: { packageId: "0xtest" },
    network: "testnet",
    spendingLimits: { maxPerTx: 0n, maxPerSession: 0n, sessionSpent: 0n },
  });

  it("registers without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerSupportedTool(server, makeCtx());
  });

  it("returns all three supported tokens", async () => {
    const ctx = makeCtx();
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const handlers = captureHandlers(server, ctx);
    const handler = handlers.get("sweefi_supported_tokens")!;

    const result = await handler({});
    const text = result.content[0].text;

    expect(text).toContain("SUI:");
    expect(text).toContain("USDC:");
    expect(text).toContain("USDT:");
    expect(text).toContain("9 decimals");
    expect(text).toContain("6 decimals");
  });

  it("includes network and package ID", async () => {
    const ctx = makeCtx();
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const handlers = captureHandlers(server, ctx);
    const handler = handlers.get("sweefi_supported_tokens")!;

    const result = await handler({});
    const text = result.content[0].text;

    expect(text).toContain("testnet");
    expect(text).toContain("0xtest");
  });

  it("works without a signer (read-only tool)", async () => {
    const ctx = makeCtx(); // signer: null — should still work
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const handlers = captureHandlers(server, ctx);
    const handler = handlers.get("sweefi_supported_tokens")!;

    // Should not throw
    const result = await handler({});
    expect(result.content[0].text).toContain("SweeFi supported tokens");
  });
});
