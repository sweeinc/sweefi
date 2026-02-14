import { describe, it, expect, vi } from "vitest";
import { createContext, requireSigner } from "../src/context.js";

vi.mock("@mysten/sui/client", () => ({
  SuiClient: vi.fn().mockImplementation(() => ({})),
  getFullnodeUrl: vi.fn().mockReturnValue("https://fullnode.testnet.sui.io:443"),
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
});

describe("requireSigner", () => {
  it("throws when no signer configured", () => {
    const ctx = createContext();
    expect(() => requireSigner(ctx)).toThrow("Wallet not configured");
  });
});
