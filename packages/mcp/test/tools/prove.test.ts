import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProveTool } from "../../src/tools/prove.js";
import type { SweepayContext } from "../../src/context.js";

vi.mock("@sweepay/sui/ptb", () => ({
  buildPayAndProveTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
}));

describe("sweepay_pay_and_prove", () => {
  it("registers without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const ctx: SweepayContext = {
      suiClient: {} as any,
      signer: null,
      config: { packageId: "0xtest" },
      network: "testnet",
    };
    registerProveTool(server, ctx);
    expect(true).toBe(true);
  });
});
