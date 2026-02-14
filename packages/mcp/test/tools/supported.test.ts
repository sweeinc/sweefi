import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSupportedTool } from "../../src/tools/supported.js";
import type { SweepayContext } from "../../src/context.js";

describe("sweepay_supported_tokens", () => {
  it("registers without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const ctx: SweepayContext = {
      suiClient: {} as any,
      signer: null,
      config: { packageId: "0xtest" },
      network: "testnet",
    };
    registerSupportedTool(server, ctx);
    expect(true).toBe(true);
  });
});
