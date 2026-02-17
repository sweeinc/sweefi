import { describe, it, expect, vi } from "vitest";
import { createContext, requireSigner } from "../src/context.js";

vi.mock("@mysten/sui/jsonRpc", () => ({
  SuiJsonRpcClient: vi.fn().mockImplementation(() => ({})),
  getJsonRpcFullnodeUrl: vi.fn().mockReturnValue("https://fullnode.testnet.sui.io:443"),
}));

describe("createContext", () => {
  it("defaults to testnet with no wallet", () => {
    const ctx = createContext();
    expect(ctx.network).toBe("testnet");
    expect(ctx.signer).toBeNull();
    expect(ctx.suiClient).toBeDefined();
    expect(ctx.config.packageId).toBeDefined();
  });

  it("uses custom RPC URL", () => {
    const ctx = createContext({ rpcUrl: "https://custom-rpc.example.com" });
    expect(ctx.suiClient).toBeDefined();
  });

  it("uses custom package ID", () => {
    const ctx = createContext({ packageId: "0xcustom" });
    expect(ctx.config.packageId).toBe("0xcustom");
  });

  it("rejects invalid network", () => {
    expect(() => createContext({ network: "foobar" })).toThrow('Invalid SUI_NETWORK "foobar"');
  });

  it("allows custom network when rpcUrl is provided", () => {
    const ctx = createContext({ network: "localnet", rpcUrl: "http://localhost:9000" });
    expect(ctx.network).toBe("localnet");
  });

  it("parses spending limit env vars with underscores", () => {
    process.env.MCP_MAX_PER_TX = "1_000_000_000";
    try {
      const ctx = createContext();
      expect(ctx.spendingLimits.maxPerTx).toBe(1000000000n);
    } finally {
      delete process.env.MCP_MAX_PER_TX;
    }
  });

  it("rejects invalid spending limit env vars", () => {
    process.env.MCP_MAX_PER_TX = "not-a-number";
    try {
      expect(() => createContext()).toThrow('MCP_MAX_PER_TX="not-a-number" is not a valid integer');
    } finally {
      delete process.env.MCP_MAX_PER_TX;
    }
  });
});

describe("requireSigner", () => {
  it("throws when no signer configured", () => {
    const ctx = createContext();
    expect(() => requireSigner(ctx)).toThrow("Wallet not configured");
  });
});
