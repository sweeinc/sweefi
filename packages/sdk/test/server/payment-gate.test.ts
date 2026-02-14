import { describe, it, expect, vi } from "vitest";

// Mock @x402/hono to capture what paymentGate passes to it
const mockMiddleware = vi.fn();
vi.mock("@x402/hono", () => ({
  paymentMiddleware: vi.fn().mockReturnValue(mockMiddleware),
}));

// Mock @sweepay/core/server
vi.mock("@sweepay/core/server", () => {
  const mockRegister = vi.fn().mockReturnThis();
  return {
    HTTPFacilitatorClient: vi.fn().mockImplementation((config: Record<string, unknown>) => ({
      url: config.url,
      _config: config,
    })),
    x402ResourceServer: vi.fn().mockImplementation(() => ({
      register: mockRegister,
    })),
  };
});

// Mock @sweepay/sui/exact/server
vi.mock("@sweepay/sui/exact/server", () => ({
  ExactSuiScheme: vi.fn().mockImplementation(() => ({
    scheme: "exact",
  })),
}));

describe("paymentGate", () => {
  it("exports paymentGate function", async () => {
    const { paymentGate } = await import("../../src/server");
    expect(typeof paymentGate).toBe("function");
  });

  it("returns Hono middleware (a function)", async () => {
    const { paymentGate } = await import("../../src/server");

    const middleware = paymentGate({
      price: "$0.001",
      network: "sui:testnet",
      payTo: "0x" + "a".repeat(64),
    });

    expect(typeof middleware).toBe("function");
  });

  it("creates HTTPFacilitatorClient with default URL", async () => {
    const { paymentGate } = await import("../../src/server");
    const { HTTPFacilitatorClient } = await import("@sweepay/core/server");

    paymentGate({
      price: "$0.001",
      network: "sui:testnet",
      payTo: "0x" + "a".repeat(64),
    });

    expect(HTTPFacilitatorClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://swee-facilitator.fly.dev",
      }),
    );
  });

  it("creates HTTPFacilitatorClient with custom URL", async () => {
    const { paymentGate } = await import("../../src/server");
    const { HTTPFacilitatorClient } = await import("@sweepay/core/server");

    paymentGate({
      price: "$0.001",
      network: "sui:testnet",
      payTo: "0x" + "a".repeat(64),
      facilitatorUrl: "https://my-facilitator.example.com",
    });

    expect(HTTPFacilitatorClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://my-facilitator.example.com",
      }),
    );
  });

  it("registers ExactSuiScheme server on the resource server", async () => {
    const { paymentGate } = await import("../../src/server");
    const { x402ResourceServer } = await import("@sweepay/core/server");

    paymentGate({
      price: "$0.001",
      network: "sui:testnet",
      payTo: "0x" + "a".repeat(64),
    });

    // x402ResourceServer was constructed
    expect(x402ResourceServer).toHaveBeenCalled();
    // .register was called with the network and an ExactSuiScheme
    const serverInstance = (x402ResourceServer as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(serverInstance.register).toHaveBeenCalledWith(
      "sui:testnet",
      expect.objectContaining({ scheme: "exact" }),
    );
  });

  it("passes correct route config to paymentMiddleware", async () => {
    const { paymentGate } = await import("../../src/server");
    const { paymentMiddleware } = await import("@x402/hono");

    paymentGate({
      price: "$0.001",
      network: "sui:testnet",
      payTo: "0x" + "a".repeat(64),
    });

    expect(paymentMiddleware).toHaveBeenCalledWith(
      {
        accepts: {
          scheme: "exact",
          payTo: "0x" + "a".repeat(64),
          price: "$0.001",
          network: "sui:testnet",
          maxTimeoutSeconds: 30,
        },
      },
      expect.anything(), // the x402ResourceServer instance
    );
  });

  it("passes custom maxTimeoutSeconds", async () => {
    const { paymentGate } = await import("../../src/server");
    const { paymentMiddleware } = await import("@x402/hono");

    paymentGate({
      price: "$0.001",
      network: "sui:testnet",
      payTo: "0x" + "a".repeat(64),
      maxTimeoutSeconds: 60,
    });

    expect(paymentMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        accepts: expect.objectContaining({
          maxTimeoutSeconds: 60,
        }),
      }),
      expect.anything(),
    );
  });

  it("includes auth headers when apiKey is provided", async () => {
    const { paymentGate } = await import("../../src/server");
    const { HTTPFacilitatorClient } = await import("@sweepay/core/server");

    paymentGate({
      price: "$0.001",
      network: "sui:testnet",
      payTo: "0x" + "a".repeat(64),
      apiKey: "test-api-key-123",
    });

    // HTTPFacilitatorClient should receive createAuthHeaders
    const config = (HTTPFacilitatorClient as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(config).toHaveProperty("createAuthHeaders");
    expect(typeof config.createAuthHeaders).toBe("function");

    // Verify the auth headers are correct
    const headers = await config.createAuthHeaders();
    expect(headers.verify).toEqual({ Authorization: "Bearer test-api-key-123" });
    expect(headers.settle).toEqual({ Authorization: "Bearer test-api-key-123" });
    expect(headers.supported).toEqual({ Authorization: "Bearer test-api-key-123" });
  });

  it("does not include auth headers when apiKey is not provided", async () => {
    const { paymentGate } = await import("../../src/server");
    const { HTTPFacilitatorClient } = await import("@sweepay/core/server");

    paymentGate({
      price: "$0.001",
      network: "sui:testnet",
      payTo: "0x" + "a".repeat(64),
    });

    const config = (HTTPFacilitatorClient as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(config.createAuthHeaders).toBeUndefined();
  });

  it("works with numeric price", async () => {
    const { paymentGate } = await import("../../src/server");
    const { paymentMiddleware } = await import("@x402/hono");

    paymentGate({
      price: 0.001,
      network: "sui:testnet",
      payTo: "0x" + "a".repeat(64),
    });

    expect(paymentMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        accepts: expect.objectContaining({
          price: 0.001,
        }),
      }),
      expect.anything(),
    );
  });

  it("works with mainnet network", async () => {
    const { paymentGate } = await import("../../src/server");
    const { x402ResourceServer } = await import("@sweepay/core/server");

    paymentGate({
      price: "$0.001",
      network: "sui:mainnet",
      payTo: "0x" + "a".repeat(64),
    });

    const serverInstance = (x402ResourceServer as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    expect(serverInstance.register).toHaveBeenCalledWith(
      "sui:mainnet",
      expect.objectContaining({ scheme: "exact" }),
    );
  });
});
