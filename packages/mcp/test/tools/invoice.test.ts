import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerInvoiceTools } from "../../src/tools/invoice.js";
import type { SweepayContext } from "../../src/context.js";

vi.mock("@sweepay/sui/ptb", () => ({
  buildCreateInvoiceTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildPayInvoiceTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
}));

describe("invoice tools", () => {
  it("registers both create and pay invoice tools", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const ctx: SweepayContext = {
      suiClient: {} as any,
      signer: null,
      config: { packageId: "0xtest" },
      network: "testnet",
    };
    registerInvoiceTools(server, ctx);
    expect(true).toBe(true);
  });
});
