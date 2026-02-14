import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPayTool } from "../../src/tools/pay.js";
import type { SweepayContext } from "../../src/context.js";

vi.mock("@sweepay/sui/ptb", () => ({
  buildPayTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
}));

describe("sweepay_pay", () => {
  it("registers without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const ctx: SweepayContext = {
      suiClient: {
        signAndExecuteTransaction: vi.fn().mockResolvedValue({
          digest: "test_digest",
          objectChanges: [
            {
              type: "created",
              objectType: "0x::payment::PaymentReceipt",
              objectId: "0xreceipt",
            },
          ],
        }),
      } as any,
      signer: null,
      config: { packageId: "0xtest" },
      network: "testnet",
    };
    registerPayTool(server, ctx);
    expect(true).toBe(true);
  });
});
