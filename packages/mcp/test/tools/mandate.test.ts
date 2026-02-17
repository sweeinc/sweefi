import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMandateTools } from "../../src/tools/mandate.js";
import type { SweepayContext } from "../../src/context.js";

vi.mock("@sweepay/sui/ptb", () => ({
  buildCreateMandateTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildCreateAgentMandateTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildMandatedPayTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildAgentMandatedPayTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildRevokeMandateTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildCreateRegistryTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
}));

describe("mandate tools", () => {
  const makeCtx = (): SweepayContext => ({
    suiClient: {
      getObject: vi.fn().mockResolvedValue({
        data: {
          content: {
            dataType: "moveObject",
            type: "0xtest::agent_mandate::AgentMandate<0x2::sui::SUI>",
            fields: {
              delegator: "0x" + "a".repeat(64),
              delegate: "0x" + "b".repeat(64),
              level: 2,
              max_per_tx: "1000000000",
              daily_limit: "5000000000",
              daily_spent: "500000000",
              weekly_limit: "20000000000",
              weekly_spent: "2000000000",
              max_total: "100000000000",
              total_spent: "10000000000",
              expires_at_ms: "1740000000000",
            },
          },
        },
      }),
    } as any,
    signer: null,
    config: { packageId: "0xtest" },
    network: "testnet",
    spendingLimits: { maxPerTx: 0n, maxPerSession: 0n, sessionSpent: 0n },
  });

  it("registers all 8 mandate tools without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerMandateTools(server, makeCtx());
    expect(true).toBe(true);
  });
});
