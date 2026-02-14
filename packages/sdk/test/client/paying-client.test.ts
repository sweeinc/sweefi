import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

// Mock @mysten/sui/client to avoid real RPC calls
const mockSuiClient = {
  getCoins: vi.fn(),
  dryRunTransactionBlock: vi.fn(),
};

vi.mock("@mysten/sui/client", () => ({
  SuiClient: vi.fn().mockImplementation((config: { url: string }) => {
    // Attach URL for test inspection
    return { ...mockSuiClient, _url: config.url };
  }),
  getFullnodeUrl: vi.fn().mockImplementation((network: string) => {
    const urls: Record<string, string> = {
      testnet: "https://fullnode.testnet.sui.io:443",
      mainnet: "https://fullnode.mainnet.sui.io:443",
      devnet: "https://fullnode.devnet.sui.io:443",
    };
    return urls[network] ?? `https://fullnode.${network}.sui.io:443`;
  }),
}));

describe("createPayingClient", () => {
  it("exports createPayingClient function", async () => {
    const { createPayingClient } = await import("../../src/client");
    expect(typeof createPayingClient).toBe("function");
  });

  it("returns expected shape with all required properties", async () => {
    const { createPayingClient } = await import("../../src/client");
    const wallet = Ed25519Keypair.generate();

    const client = createPayingClient({
      wallet,
      network: "sui:testnet",
    });

    expect(client).toHaveProperty("fetch");
    expect(client).toHaveProperty("address");
    expect(client).toHaveProperty("network", "sui:testnet");
    expect(client).toHaveProperty("x402Client");
    expect(client).toHaveProperty("facilitatorUrl");
    expect(typeof client.fetch).toBe("function");
    expect(typeof client.address).toBe("string");
  });

  it("derives address from wallet keypair (0x + 64 hex chars)", async () => {
    const { createPayingClient } = await import("../../src/client");
    const wallet = Ed25519Keypair.generate();
    const expectedAddress = wallet.toSuiAddress();

    const client = createPayingClient({
      wallet,
      network: "sui:testnet",
    });

    expect(client.address).toBe(expectedAddress);
    expect(client.address).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("produces deterministic address for same keypair", async () => {
    const { createPayingClient } = await import("../../src/client");
    const wallet = Ed25519Keypair.generate();

    const client1 = createPayingClient({ wallet, network: "sui:testnet" });
    const client2 = createPayingClient({ wallet, network: "sui:testnet" });

    expect(client1.address).toBe(client2.address);
  });

  it("uses default facilitator URL when not specified", async () => {
    const { createPayingClient } = await import("../../src/client");
    const { DEFAULT_FACILITATOR_URL } = await import("../../src/shared/constants");
    const wallet = Ed25519Keypair.generate();

    const client = createPayingClient({
      wallet,
      network: "sui:testnet",
    });

    expect(client.facilitatorUrl).toBe(DEFAULT_FACILITATOR_URL);
    expect(client.facilitatorUrl).toBe("https://swee-facilitator.fly.dev");
  });

  it("uses custom facilitator URL when specified", async () => {
    const { createPayingClient } = await import("../../src/client");
    const wallet = Ed25519Keypair.generate();

    const client = createPayingClient({
      wallet,
      network: "sui:testnet",
      facilitatorUrl: "https://custom.facilitator.example.com",
    });

    expect(client.facilitatorUrl).toBe("https://custom.facilitator.example.com");
  });

  it("uses custom RPC URL when specified", async () => {
    const { SuiClient } = await import("@mysten/sui/client");
    const { createPayingClient } = await import("../../src/client");
    const wallet = Ed25519Keypair.generate();

    createPayingClient({
      wallet,
      network: "sui:testnet",
      rpcUrl: "https://my-custom-rpc.example.com",
    });

    // SuiClient should be constructed with the custom URL
    expect(SuiClient).toHaveBeenCalledWith({ url: "https://my-custom-rpc.example.com" });
  });

  it("uses getFullnodeUrl for default RPC when no custom URL", async () => {
    const { getFullnodeUrl } = await import("@mysten/sui/client");
    const { createPayingClient } = await import("../../src/client");
    const wallet = Ed25519Keypair.generate();

    createPayingClient({
      wallet,
      network: "sui:testnet",
    });

    expect(getFullnodeUrl).toHaveBeenCalledWith("testnet");
  });

  it("works with all supported networks", async () => {
    const { createPayingClient } = await import("../../src/client");
    const { getFullnodeUrl } = await import("@mysten/sui/client");
    const wallet = Ed25519Keypair.generate();

    for (const network of ["sui:testnet", "sui:mainnet", "sui:devnet"] as const) {
      const client = createPayingClient({ wallet, network });
      expect(client.network).toBe(network);
    }

    expect(getFullnodeUrl).toHaveBeenCalledWith("testnet");
    expect(getFullnodeUrl).toHaveBeenCalledWith("mainnet");
    expect(getFullnodeUrl).toHaveBeenCalledWith("devnet");
  });

  it("preserves the x402Client for advanced usage", async () => {
    const { createPayingClient } = await import("../../src/client");
    const { x402Client } = await import("@sweepay/core/client");
    const wallet = Ed25519Keypair.generate();

    const client = createPayingClient({
      wallet,
      network: "sui:testnet",
    });

    expect(client.x402Client).toBeInstanceOf(x402Client);
  });
});

describe("createPayingClient — fetch behavior", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("passes non-402 responses through untouched", async () => {
    const mockResponse = new Response(JSON.stringify({ data: "hello" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const { createPayingClient } = await import("../../src/client");
    const wallet = Ed25519Keypair.generate();
    const client = createPayingClient({ wallet, network: "sui:testnet" });

    const response = await client.fetch("https://api.example.com/free/data");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: "hello" });
    // Only one fetch call — no retry
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("passes error responses (non-402) through untouched", async () => {
    const mockResponse = new Response("Not Found", { status: 404 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const { createPayingClient } = await import("../../src/client");
    const wallet = Ed25519Keypair.generate();
    const client = createPayingClient({ wallet, network: "sui:testnet" });

    const response = await client.fetch("https://api.example.com/missing");

    expect(response.status).toBe(404);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("passes 500 responses through without payment attempt", async () => {
    const mockResponse = new Response("Internal Server Error", { status: 500 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const { createPayingClient } = await import("../../src/client");
    const wallet = Ed25519Keypair.generate();
    const client = createPayingClient({ wallet, network: "sui:testnet" });

    const response = await client.fetch("https://api.example.com/broken");

    expect(response.status).toBe(500);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
