import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProveTool } from "../../src/tools/prove.js";
import type { SweefiContext } from "../../src/context.js";

vi.mock("@sweefi/sui/ptb", () => ({
  buildPayAndProveTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
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
  registerProveTool(server, ctx);
  spy.mockRestore();
  return handlers;
}

describe("sweefi_pay_and_prove", () => {
  const makeCtx = (overrides?: Partial<SweefiContext>): SweefiContext => ({
    suiClient: {
      signAndExecuteTransaction: vi.fn().mockResolvedValue({
        digest: "test_digest_prove",
        effects: { status: { status: "success" } },
        objectChanges: [
          {
            type: "created",
            objectType: "0xtest::payment::PaymentReceipt",
            objectId: "0xreceipt456",
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

  it("registers without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerProveTool(server, makeCtx());
  });

  it("throws when no signer configured", async () => {
    const ctx = makeCtx();
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const handlers = captureHandlers(server, ctx);
    const handler = handlers.get("sweefi_pay_and_prove")!;

    await expect(
      handler({
        recipient: "0x" + "b".repeat(64),
        amount: "1000000000",
      }),
    ).rejects.toThrow("Wallet not configured");
  });

  it("returns formatted output with receipt on success", async () => {
    const mockSigner = {
      toSuiAddress: () => "0x" + "f".repeat(64),
    };
    const ctx = makeCtx({ signer: mockSigner as any });
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const handlers = captureHandlers(server, ctx);
    const handler = handlers.get("sweefi_pay_and_prove")!;

    const result = await handler({
      recipient: "0x" + "b".repeat(64),
      amount: "1000000000",
    });
    const text = result.content[0].text;

    expect(text).toContain("Atomic pay-to-access complete!");
    expect(text).toContain("Receipt ID: 0xreceipt456");
    expect(text).toContain("test_digest_prove");
    expect(text).toContain("SEAL Integration");
  });
});
