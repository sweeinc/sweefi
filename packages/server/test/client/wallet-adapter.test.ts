import { describe, it, expect, vi } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";

vi.mock("@mysten/sui/jsonRpc", () => ({
  SuiJsonRpcClient: vi.fn().mockImplementation(() => ({
    getCoins: vi.fn(),
  })),
}));

describe("adaptWallet", () => {
  it("exports adaptWallet function", async () => {
    const { adaptWallet } = await import("../../src/client");
    expect(typeof adaptWallet).toBe("function");
  });

  it("converts Ed25519Keypair to ClientSuiSigner with correct interface", async () => {
    const { adaptWallet } = await import("../../src/client/wallet-adapter");
    const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");

    const wallet = Ed25519Keypair.generate();
    const client = new SuiJsonRpcClient({ url: "https://test", network: "testnet" });
    const signer = adaptWallet(wallet, client);

    expect(signer).toHaveProperty("address");
    expect(signer).toHaveProperty("signTransaction");
    expect(typeof signer.address).toBe("string");
    expect(typeof signer.signTransaction).toBe("function");
  });

  it("derives correct address from keypair", async () => {
    const { adaptWallet } = await import("../../src/client/wallet-adapter");
    const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");

    const wallet = Ed25519Keypair.generate();
    const client = new SuiJsonRpcClient({ url: "https://test", network: "testnet" });
    const signer = adaptWallet(wallet, client);

    expect(signer.address).toBe(wallet.toSuiAddress());
    expect(signer.address).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("produces same address as the keypair for multiple calls", async () => {
    const { adaptWallet } = await import("../../src/client/wallet-adapter");
    const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");

    const wallet = Ed25519Keypair.generate();
    const client = new SuiJsonRpcClient({ url: "https://test", network: "testnet" });
    const signer1 = adaptWallet(wallet, client);
    const signer2 = adaptWallet(wallet, client);

    expect(signer1.address).toBe(signer2.address);
  });

  it("produces different addresses for different keypairs", async () => {
    const { adaptWallet } = await import("../../src/client/wallet-adapter");
    const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");

    const wallet1 = Ed25519Keypair.generate();
    const wallet2 = Ed25519Keypair.generate();
    const client = new SuiJsonRpcClient({ url: "https://test", network: "testnet" });

    const signer1 = adaptWallet(wallet1, client);
    const signer2 = adaptWallet(wallet2, client);

    expect(signer1.address).not.toBe(signer2.address);
  });

  it("works with Secp256k1 keypair", async () => {
    const { adaptWallet } = await import("../../src/client/wallet-adapter");
    const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");

    const wallet = Secp256k1Keypair.generate();
    const client = new SuiJsonRpcClient({ url: "https://test", network: "testnet" });
    const signer = adaptWallet(wallet, client);

    expect(signer.address).toBe(wallet.toSuiAddress());
    expect(signer.address).toMatch(/^0x[0-9a-f]{64}$/);
    expect(typeof signer.signTransaction).toBe("function");
  });
});
