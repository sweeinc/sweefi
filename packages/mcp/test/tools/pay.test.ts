import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPayTool } from "../../src/tools/pay.js";
import type { SweefiContext } from "../../src/context.js";

vi.mock("@sweefi/sui/ptb", () => ({
  buildPayTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
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
  registerPayTool(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("sweefi_pay", () => {
  const makeCtx = (): SweefiContext => ({
    suiClient: {
      signAndExecuteTransaction: vi.fn().mockResolvedValue({
        digest: "test_digest",
        effects: { status: { status: "success" } },
        objectChanges: [
          {
            type: "created",
            objectType: "0x::payment::PaymentReceipt",
            objectId: "0xreceipt123",
          },
        ],
      }),
    } as any,
    signer: null,
    config: { packageId: "0xtest" },
    network: "testnet",
    spendingLimits: { maxPerTx: 0n, maxPerSession: 0n, sessionSpent: 0n },
  });

  it("registers the pay tool", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerPayTool(server, makeCtx());
  });

  it("throws when no signer configured", async () => {
    const ctx = makeCtx(); // signer: null
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const handlers = captureHandlers(server, ctx);
    const handler = handlers.get("sweefi_pay")!;

    await expect(
      handler({
        recipient: "0x" + "b".repeat(64),
        amount: "1000000000",
      }),
    ).rejects.toThrow("Wallet not configured");
  });
});
