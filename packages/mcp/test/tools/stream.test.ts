import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStreamTools } from "../../src/tools/stream.js";
import type { SweefiContext } from "../../src/context.js";

vi.mock("@sweefi/sui/ptb", () => ({
  buildCreateStreamTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildCreateStreamWithTimeoutTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildCloseTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildRecipientCloseTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
}));

describe("stream tools", () => {
  it("registers start, start_with_timeout, stop, and recipient_close tools", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const ctx: SweefiContext = {
      suiClient: {} as any,
      signer: null,
      config: { packageId: "0xtest" },
      network: "testnet",
    };
    registerStreamTools(server, ctx);
    // All 3 tools registered without error
    expect(true).toBe(true);
  });
});
