import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createRoutes } from "../src/routes";

// Mock facilitator that we control
function createMockFacilitator() {
  return {
    getSupported: vi.fn().mockReturnValue({
      kinds: [
        { x402Version: 2, scheme: "exact", network: "sui:testnet" },
        { x402Version: 2, scheme: "exact", network: "sui:mainnet" },
      ],
      extensions: [],
      signers: { "sui:*": [] },
    }),
    verify: vi.fn().mockResolvedValue({
      isValid: true,
      payer: "0x" + "a".repeat(64),
    }),
    settle: vi.fn().mockResolvedValue({
      success: true,
      payer: "0x" + "a".repeat(64),
      transaction: "mock-tx-digest",
      network: "sui:testnet",
    }),
  };
}

describe("routes", () => {
  describe("GET /health", () => {
    it("returns ok status", async () => {
      const facilitator = createMockFacilitator();
      const app = createRoutes(facilitator as any);

      const res = await app.request("/health");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body).toHaveProperty("timestamp");
    });
  });

  describe("GET /supported", () => {
    it("delegates to facilitator.getSupported()", async () => {
      const facilitator = createMockFacilitator();
      const app = createRoutes(facilitator as any);

      const res = await app.request("/supported");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.kinds).toHaveLength(2);
      expect(body.kinds[0].network).toBe("sui:testnet");
      expect(body.kinds[1].network).toBe("sui:mainnet");
      expect(facilitator.getSupported).toHaveBeenCalledOnce();
    });
  });

  describe("POST /verify", () => {
    it("delegates to facilitator.verify()", async () => {
      const facilitator = createMockFacilitator();
      const app = createRoutes(facilitator as any);

      const payload = { paymentPayload: { mock: "payload" }, paymentRequirements: { mock: "requirements" } };
      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isValid).toBe(true);
      expect(body.payer).toBe("0x" + "a".repeat(64));
      expect(facilitator.verify).toHaveBeenCalledWith(
        { mock: "payload" },
        { mock: "requirements" },
      );
    });

    it("returns error when verify fails", async () => {
      const facilitator = createMockFacilitator();
      facilitator.verify.mockResolvedValue({
        isValid: false,
        invalidReason: "INSUFFICIENT_AMOUNT",
        invalidMessage: "Payment amount too low",
      });
      const app = createRoutes(facilitator as any);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPayload: {}, paymentRequirements: {} }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isValid).toBe(false);
      expect(body.invalidReason).toBe("INSUFFICIENT_AMOUNT");
    });
  });

  describe("POST /settle", () => {
    it("delegates to facilitator.settle()", async () => {
      const facilitator = createMockFacilitator();
      const app = createRoutes(facilitator as any);

      const payload = { paymentPayload: { mock: "payload" }, paymentRequirements: { mock: "requirements" } };
      const res = await app.request("/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.transaction).toBe("mock-tx-digest");
      expect(body.network).toBe("sui:testnet");
      expect(facilitator.settle).toHaveBeenCalledWith(
        { mock: "payload" },
        { mock: "requirements" },
      );
    });

    it("returns error when settle fails", async () => {
      const facilitator = createMockFacilitator();
      facilitator.settle.mockResolvedValue({
        success: false,
        errorReason: "EXECUTION_FAILED",
        errorMessage: "Transaction failed on-chain",
        transaction: "",
        network: "sui:testnet",
      });
      const app = createRoutes(facilitator as any);

      const res = await app.request("/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPayload: {}, paymentRequirements: {} }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.errorReason).toBe("EXECUTION_FAILED");
    });
  });
});
