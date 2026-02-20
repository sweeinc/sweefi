import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProveTool } from "../../src/tools/prove.js";
import type { SweefiContext } from "../../src/context.js";

vi.mock("@sweefi/sui/ptb", () => ({
  buildPayAndProveTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
}));

describe("sweefi_pay_and_prove", () => {
  it("registers without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const ctx: SweefiContext = {
      suiClient: {} as any,
      signer: null,
      config: { packageId: "0xtest" },
      network: "testnet",
    };
    registerProveTool(server, ctx);
    expect(true).toBe(true);
  });
});
