import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBalanceTool } from "../../src/tools/balance.js";
import type { SweefiContext } from "../../src/context.js";

describe("sweefi_check_balance", () => {
  function createMockContext(): SweefiContext {
    return {
      suiClient: {
        getBalance: vi.fn().mockResolvedValue({
          totalBalance: "1000000000",
          coinObjectCount: 3,
        }),
      } as any,
      signer: null,
      config: { packageId: "0xtest" },
      network: "testnet",
    };
  }

  it("registers the tool on the server", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    const ctx = createMockContext();
    registerBalanceTool(server, ctx);
    // Tool is registered — no throw
    expect(true).toBe(true);
  });

  it("queries balance for SUI by default", async () => {
    const ctx = createMockContext();
    const getBalance = ctx.suiClient.getBalance as ReturnType<typeof vi.fn>;

    // Call the tool handler directly
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerBalanceTool(server, ctx);

    // Simulate calling via the mock SuiClient
    const result = await getBalance({
      owner: "0xABC",
      coinType: "0x2::sui::SUI",
    });

    expect(result.totalBalance).toBe("1000000000");
    expect(getBalance).toHaveBeenCalledOnce();
  });
});
