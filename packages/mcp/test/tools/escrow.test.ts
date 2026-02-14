import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEscrowTools } from "../../src/tools/escrow.js";
import type { SweepayContext } from "../../src/context.js";

vi.mock("@sweepay/sui/ptb", () => ({
  buildCreateEscrowTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildReleaseEscrowTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildRefundEscrowTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildDisputeEscrowTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
}));

describe("escrow tools", () => {
  const makeCtx = (): SweepayContext => ({
    suiClient: {} as any,
    signer: null,
    config: { packageId: "0xtest" },
    network: "testnet",
  });

  it("registers all 4 escrow tools without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerEscrowTools(server, makeCtx());
    expect(true).toBe(true);
  });
});
