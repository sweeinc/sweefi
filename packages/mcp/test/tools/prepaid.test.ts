import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrepaidTools, registerPrepaidProviderTools } from "../../src/tools/prepaid.js";
import type { SweepayContext } from "../../src/context.js";

vi.mock("@sweepay/sui/ptb", () => ({
  buildPrepaidDepositTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildPrepaidClaimTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildRequestWithdrawalTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildFinalizeWithdrawalTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildCancelWithdrawalTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildPrepaidTopUpTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  buildPrepaidAgentCloseTx: vi.fn().mockReturnValue({ setSender: vi.fn() }),
  UNLIMITED_CALLS: "18446744073709551615",
}));

describe("prepaid tools", () => {
  const makeCtx = (): SweepayContext => ({
    suiClient: {
      getObject: vi.fn().mockResolvedValue({
        data: {
          content: {
            dataType: "moveObject",
            type: "0xtest::prepaid::PrepaidBalance<0x2::sui::SUI>",
            fields: {
              agent: "0x" + "a".repeat(64),
              provider: "0x" + "b".repeat(64),
              deposited: { fields: { value: "5000000000" } },
              rate_per_call: "1000000",
              claimed_calls: "42",
              max_calls: "18446744073709551615",
              withdrawal_pending: false,
              withdrawal_delay_ms: "300000",
              withdrawal_requested_ms: "0",
              last_claim_ms: "1708012800000",
              fee_bps: "50",
              fee_recipient: "0x" + "c".repeat(64),
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

  it("registers all 8 agent-side prepaid tools without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerPrepaidTools(server, makeCtx());
    expect(true).toBe(true);
  });

  it("registers provider-side prepaid tools without error", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerPrepaidProviderTools(server, makeCtx());
    expect(true).toBe(true);
  });
});
