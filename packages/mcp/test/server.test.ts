import { describe, it, expect, vi } from "vitest";
import { createSweefiMcpServer } from "../src/server.js";

// Mock the SuiJsonRpcClient to avoid real RPC calls
vi.mock("@mysten/sui/jsonRpc", () => ({
  SuiJsonRpcClient: vi.fn().mockImplementation(() => ({
    getBalance: vi.fn(),
    getObject: vi.fn(),
    queryEvents: vi.fn(),
    signAndExecuteTransaction: vi.fn(),
  })),
  getJsonRpcFullnodeUrl: vi.fn().mockReturnValue("https://fullnode.testnet.sui.io:443"),
}));

describe("createSweefiMcpServer", () => {
  it("creates server with default config", () => {
    const { server, context } = createSweefiMcpServer();
    expect(server).toBeDefined();
    expect(context).toBeDefined();
    expect(context.network).toBe("testnet");
    expect(context.signer).toBeNull();
  });

  it("creates server with custom network", () => {
    const { context } = createSweefiMcpServer({ network: "mainnet" });
    expect(context.network).toBe("mainnet");
  });

  it("creates server with custom package ID", () => {
    const customId = "0x1234567890abcdef";
    const { context } = createSweefiMcpServer({ packageId: customId });
    expect(context.config.packageId).toBe(customId);
  });
});
