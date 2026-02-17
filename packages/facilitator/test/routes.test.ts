import { describe, it, expect, vi } from "vitest";
import { createRoutes } from "../src/routes";
import { UsageTracker } from "../src/metering/usage-tracker";
import { S402_VERSION } from "s402";

// Mock s402Facilitator
function createMockFacilitator() {
  return {
    supportedSchemes: vi.fn().mockImplementation((network: string) => {
      if (network === "sui:testnet" || network === "sui:mainnet") {
        return ["exact", "prepaid"];
      }
      return [];
    }),
    verify: vi.fn().mockResolvedValue({
      valid: true,
      payerAddress: "0x" + "a".repeat(64),
    }),
    settle: vi.fn().mockResolvedValue({
      success: true,
      txDigest: "mock-tx-digest",
    }),
    process: vi.fn().mockResolvedValue({
      success: true,
      txDigest: "mock-tx-digest",
    }),
    register: vi.fn(),
    supports: vi.fn().mockReturnValue(true),
  };
}

/** Valid mock payloads that pass body shape validation */
const VALID_PAYLOAD = { scheme: "exact", payload: { transaction: "abc", signature: "def" } };
const VALID_REQUIREMENTS = { network: "sui:testnet", amount: "1000000", payTo: "0x" + "b".repeat(64) };

describe("routes", () => {
  describe("GET /health", () => {
    it("returns ok status", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const app = createRoutes(facilitator as any, tracker, 50);

      const res = await app.request("/health");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body).toHaveProperty("timestamp");
    });
  });

  describe("GET /supported", () => {
    it("returns supported networks and schemes", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const app = createRoutes(facilitator as any, tracker, 50);

      const res = await app.request("/supported");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.s402Version).toBe(S402_VERSION);
      expect(body.networks).toHaveProperty("sui:testnet");
      expect(body.networks["sui:testnet"]).toContain("exact");
      expect(body.networks["sui:testnet"]).toContain("prepaid");
    });
  });

  describe("POST /verify", () => {
    it("delegates to facilitator.verify()", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const app = createRoutes(facilitator as any, tracker, 50);

      const payload = { paymentPayload: VALID_PAYLOAD, paymentRequirements: VALID_REQUIREMENTS };
      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(true);
      expect(body.payerAddress).toBe("0x" + "a".repeat(64));
      expect(facilitator.verify).toHaveBeenCalledWith(
        VALID_PAYLOAD,
        VALID_REQUIREMENTS,
      );
    });

    it("returns error when verify fails", async () => {
      const facilitator = createMockFacilitator();
      facilitator.verify.mockResolvedValue({
        valid: false,
        invalidReason: "Amount insufficient",
      });
      const tracker = new UsageTracker();
      const app = createRoutes(facilitator as any, tracker, 50);

      const res = await app.request("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPayload: VALID_PAYLOAD, paymentRequirements: VALID_REQUIREMENTS }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(false);
      expect(body.invalidReason).toBe("Amount insufficient");
    });
  });

  describe("POST /settle", () => {
    it("delegates to facilitator.settle()", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const app = createRoutes(facilitator as any, tracker, 50);

      const payload = { paymentPayload: VALID_PAYLOAD, paymentRequirements: VALID_REQUIREMENTS };
      const res = await app.request("/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.txDigest).toBe("mock-tx-digest");
      expect(facilitator.settle).toHaveBeenCalledWith(
        VALID_PAYLOAD,
        VALID_REQUIREMENTS,
      );
    });

    it("returns error when settle fails", async () => {
      const facilitator = createMockFacilitator();
      facilitator.settle.mockResolvedValue({
        success: false,
        error: "Transaction failed on-chain",
      });
      const tracker = new UsageTracker();
      const app = createRoutes(facilitator as any, tracker, 50);

      const res = await app.request("/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPayload: VALID_PAYLOAD, paymentRequirements: VALID_REQUIREMENTS }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe("Transaction failed on-chain");
    });
  });

  describe("POST /s402/process", () => {
    it("delegates to facilitator.process() for atomic verify+settle", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const app = createRoutes(facilitator as any, tracker, 50);

      const payload = { paymentPayload: VALID_PAYLOAD, paymentRequirements: VALID_REQUIREMENTS };
      const res = await app.request("/s402/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.txDigest).toBe("mock-tx-digest");
      expect(facilitator.process).toHaveBeenCalledWith(
        VALID_PAYLOAD,
        VALID_REQUIREMENTS,
      );
    });
  });

  describe("GET /.well-known/s402.json", () => {
    it("returns s402 discovery document", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const app = createRoutes(facilitator as any, tracker, 50);

      const res = await app.request("/.well-known/s402.json");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.s402Version).toBe(S402_VERSION);
      expect(body.schemes).toContain("exact");
      expect(body.schemes).toContain("prepaid");
      expect(body.networks).toContain("sui:testnet");
    });
  });
});
