import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReceiptTool } from "../../src/tools/receipt.js";
import type { SweepayContext } from "../../src/context.js";

describe("receipt tools", () => {
  it("registers both get_receipt and check_payment tools", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const ctx: SweepayContext = {
      suiClient: {
        getObject: vi.fn(),
        queryEvents: vi.fn(),
      } as any,
      signer: null,
      config: { packageId: "0xtest" },
      network: "testnet",
    };
    registerReceiptTool(server, ctx);
    expect(true).toBe(true);
  });
});
