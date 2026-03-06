import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
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

  describe("POST /sponsor", () => {
    function createMockGasSponsorService(overrides: Partial<{
      initialized: boolean;
      address: string;
      sponsor: ReturnType<typeof vi.fn>;
    }> = {}) {
      return {
        initialized: overrides.initialized ?? true,
        address: overrides.address ?? "0x" + "c".repeat(64),
        sponsor: overrides.sponsor ?? vi.fn().mockResolvedValue({
          transactionBytes: "mock-tx-bytes-base64",
          sponsorSignature: "mock-sponsor-sig-base64",
          gasBudget: 10_000_000n,
          gasPrice: 750n,
          reservation: { objectId: "0x" + "d".repeat(64), reservedAt: Date.now() },
        }),
        reportSettlement: vi.fn().mockResolvedValue(undefined),
        getStats: vi.fn().mockReturnValue({ totalCoins: 10, availableCoins: 8 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
    }

    it("returns 503 when gas sponsorship is not configured", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      // No gasSponsorService passed (7th arg = undefined)
      const app = createRoutes(facilitator as any, tracker, 50);

      const res = await app.request("/sponsor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "0x" + "a".repeat(64),
          transactionKindBytes: "AQIDBA==",
          network: "sui:testnet",
        }),
      });

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toContain("not enabled");
    });

    it("returns 503 when gas sponsor is still initializing", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const gasSponsor = createMockGasSponsorService({ initialized: false });
      const app = createRoutes(facilitator as any, tracker, 50, undefined, undefined, undefined, gasSponsor as any);

      const res = await app.request("/sponsor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "0x" + "a".repeat(64),
          transactionKindBytes: "AQIDBA==",
          network: "sui:testnet",
        }),
      });

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toContain("initializing");
    });

    it("validates sender address format", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const gasSponsor = createMockGasSponsorService();
      const app = createRoutes(facilitator as any, tracker, 50, undefined, undefined, undefined, gasSponsor as any);

      const res = await app.request("/sponsor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "bad-address",
          transactionKindBytes: "AQIDBA==",
          network: "sui:testnet",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("valid Sui address");
    });

    it("sponsors a transaction and returns bytes + signature", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const gasSponsor = createMockGasSponsorService();
      const app = createRoutes(facilitator as any, tracker, 50, undefined, undefined, undefined, gasSponsor as any);

      const res = await app.request("/sponsor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "0x" + "a".repeat(64),
          transactionKindBytes: "AQIDBA==",
          network: "sui:testnet",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.transactionBytes).toBe("mock-tx-bytes-base64");
      expect(body.sponsorSignature).toBe("mock-sponsor-sig-base64");
      expect(body.gasBudget).toBe("10000000");
      expect(body.gasPrice).toBe("750");
      expect(body.sponsorAddress).toBe("0x" + "c".repeat(64));
      expect(gasSponsor.sponsor).toHaveBeenCalledWith(
        "0x" + "a".repeat(64),
        "AQIDBA==",
        "sui:testnet",
      );
    });
  });

  describe("GET /.well-known/s402.json (gas sponsorship)", () => {
    it("reports gasSponsorship: true when gas service is configured", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const gasSponsor = { initialized: true, address: "0x" + "c".repeat(64) } as any;
      const app = createRoutes(facilitator as any, tracker, 50, undefined, undefined, undefined, gasSponsor);

      const res = await app.request("/.well-known/s402.json");
      const body = await res.json();
      expect(body.gasSponsorship).toBe(true);
    });

    it("reports gasSponsorship: false when gas service is not configured", async () => {
      const facilitator = createMockFacilitator();
      const tracker = new UsageTracker();
      const app = createRoutes(facilitator as any, tracker, 50);

      const res = await app.request("/.well-known/s402.json");
      const body = await res.json();
      expect(body.gasSponsorship).toBe(false);
    });
  });

  describe("GET /settlements", () => {
    /**
     * Wire apiKey into context so the route can identify the calling key.
     * In production this is done by apiKeyAuth in app.ts; here we inject it
     * manually to test the route logic in isolation.
     */
    function makeAppWithKey(apiKey: string, tracker: UsageTracker, startTime?: Date) {
      const facilitator = createMockFacilitator();
      const wrapper = new Hono();
      wrapper.use("*", async (c, next) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).set("apiKey", apiKey);
        await next();
      });
      wrapper.route("/", createRoutes(facilitator as any, tracker, 50, undefined, startTime));
      return wrapper;
    }

    it("returns empty records for a key with no settlements", async () => {
      const tracker = new UsageTracker();
      const startTime = new Date("2026-02-21T00:00:00.000Z");
      const app = makeAppWithKey("key-a", tracker, startTime);

      const res = await app.request("/settlements");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.count).toBe(0);
      expect(body.records).toEqual([]);
      expect(body.totalSettled).toBe("0");
      expect(body.dataRetainedSince).toBe("2026-02-21T00:00:00.000Z");
    });

    it("returns only records for the calling API key — not other keys", async () => {
      const tracker = new UsageTracker();
      tracker.record("key-a", "1000000", "sui:testnet", "digest-a1");
      tracker.record("key-b", "2000000", "sui:testnet", "digest-b1"); // different key
      tracker.record("key-a", "3000000", "sui:mainnet", "digest-a2");

      const app = makeAppWithKey("key-a", tracker);
      const res = await app.request("/settlements");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.count).toBe(2);
      expect(body.totalSettled).toBe("4000000"); // 1000000 + 3000000
      expect(body.records.map((r: { txDigest: string }) => r.txDigest)).toEqual(["digest-a1", "digest-a2"]);
      // key-b records must not appear
      expect(body.records.find((r: { txDigest: string }) => r.txDigest === "digest-b1")).toBeUndefined();
    });

    it("paginates records with limit and offset", async () => {
      const tracker = new UsageTracker();
      for (let i = 0; i < 5; i++) {
        tracker.record("key-a", "1000", "sui:testnet", `digest-${i}`);
      }

      const app = makeAppWithKey("key-a", tracker);

      const page1 = await (await app.request("/settlements?limit=2&offset=0")).json();
      expect(page1.records).toHaveLength(2);
      expect(page1.records[0].txDigest).toBe("digest-0");
      expect(page1.count).toBe(5); // total, not page size

      const page2 = await (await app.request("/settlements?limit=2&offset=2")).json();
      expect(page2.records).toHaveLength(2);
      expect(page2.records[0].txDigest).toBe("digest-2");

      const page3 = await (await app.request("/settlements?limit=2&offset=4")).json();
      expect(page3.records).toHaveLength(1);
      expect(page3.records[0].txDigest).toBe("digest-4");
    });

    it("clamps limit to max 1000", async () => {
      const tracker = new UsageTracker();
      const app = makeAppWithKey("key-a", tracker);
      // Just verify it doesn't error with a huge limit
      const res = await app.request("/settlements?limit=99999");
      expect(res.status).toBe(200);
    });

    it("returns 401 when apiKey is not in context", async () => {
      const tracker = new UsageTracker();
      const facilitator = createMockFacilitator();
      // No apiKey injected — simulates unauthenticated request reaching the route
      const app = createRoutes(facilitator as any, tracker, 50);
      const res = await app.request("/settlements");
      expect(res.status).toBe(401);
    });
  });
});
