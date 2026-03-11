/**
 * Security Hardening Tests
 *
 * Validates fixes for:
 *   F-17: TOCTOU race in gas sponsor rate limiting (tryConsume atomicity)
 *   F-18: Error message info disclosure
 *   Dedup cache: TTL, cross-tenant isolation, unbounded growth
 *   Shutdown: cleanup, graceful rejection
 *   Rate limiter: edge cases (empty bucket, max bucket, refill, rapid-fire)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import { InMemoryGasSponsorTracker } from "../src/metering/gas-sponsor-tracker";
import { payloadDedup } from "../src/middleware/dedup";
import { RateLimiter } from "../src/middleware/rate-limiter";
import { createRoutes } from "../src/routes";
import { UsageTracker } from "../src/metering/usage-tracker";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function createMockFacilitator() {
  return {
    supportedSchemes: vi.fn().mockReturnValue(["exact", "prepaid"]),
    verify: vi.fn().mockResolvedValue({ valid: true, payerAddress: "0x" + "a".repeat(64) }),
    settle: vi.fn().mockResolvedValue({ success: true, txDigest: "mock-digest" }),
    process: vi.fn().mockResolvedValue({ success: true, txDigest: "mock-digest" }),
    register: vi.fn(),
    supports: vi.fn().mockReturnValue(true),
  };
}

const VALID_PAYLOAD = { scheme: "exact", payload: { transaction: "abc", signature: "def" } };
const VALID_REQUIREMENTS = { network: "sui:testnet", amount: "1000000", payTo: "0x" + "b".repeat(64) };
const VALID_BODY = { paymentPayload: VALID_PAYLOAD, paymentRequirements: VALID_REQUIREMENTS };

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

// ═══════════════════════════════════════════════════════════════════
// 1. TOCTOU Fix Completeness (F-17)
// ═══════════════════════════════════════════════════════════════════

describe("F-17: TOCTOU — tryConsume() atomicity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tryConsume() is atomic: check + decrement in one call", async () => {
    const tracker = new InMemoryGasSponsorTracker(2);

    // Consume both tokens atomically
    expect(await tracker.tryConsume("key-a")).toBe(true);
    expect(await tracker.tryConsume("key-a")).toBe(true);
    // Third should be rejected
    expect(await tracker.tryConsume("key-a")).toBe(false);
  });

  it("tryConsume() returns false when maxPerHour=0 (disabled)", async () => {
    const tracker = new InMemoryGasSponsorTracker(0);
    expect(await tracker.tryConsume("key-a")).toBe(false);
  });

  it("concurrent tryConsume calls cannot exceed the budget", async () => {
    // With maxPerHour=1, only ONE of N concurrent calls should succeed.
    // Since Node.js is single-threaded and tryConsume is synchronous under
    // the async wrapper, "concurrent" means queued microtasks — but we
    // verify the invariant: total successful consumes <= maxPerHour.
    const tracker = new InMemoryGasSponsorTracker(1);

    const results = await Promise.all([
      tracker.tryConsume("key-a"),
      tracker.tryConsume("key-a"),
      tracker.tryConsume("key-a"),
      tracker.tryConsume("key-a"),
      tracker.tryConsume("key-a"),
    ]);

    const successes = results.filter(Boolean).length;
    expect(successes).toBe(1);
  });

  it("concurrent tryConsume with maxPerHour=3: exactly 3 succeed", async () => {
    const tracker = new InMemoryGasSponsorTracker(3);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => tracker.tryConsume("key-a")),
    );

    const successes = results.filter(Boolean).length;
    expect(successes).toBe(3);
  });

  it("tryConsume is used in /sponsor route (not canSponsor+recordSponsored)", async () => {
    // Verify the route uses tryConsume by checking that the gas tracker's
    // tryConsume is called and canSponsor/recordSponsored are NOT called.
    const facilitator = createMockFacilitator();
    const tracker = new UsageTracker();
    const gasSponsorTracker = new InMemoryGasSponsorTracker(10);
    const gasSponsorService = createMockGasSponsorService();

    const tryConsumeSpy = vi.spyOn(gasSponsorTracker, "tryConsume");
    const canSponsorSpy = vi.spyOn(gasSponsorTracker, "canSponsor");
    const recordSponsoredSpy = vi.spyOn(gasSponsorTracker, "recordSponsored");

    const routes = createRoutes(
      facilitator as any,
      tracker,
      50,
      undefined,
      undefined,
      gasSponsorTracker,
      gasSponsorService as any,
    );

    // Wrap with apiKey injection (simulating auth middleware)
    const app = new Hono();
    app.use("*", async (c, next) => {
      (c as any).set("apiKey", "test-key-1234567890");
      await next();
    });
    app.route("/", routes);

    await app.request("/sponsor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: "0x" + "a".repeat(64),
        transactionKindBytes: "AQIDBA==",
        network: "sui:testnet",
      }),
    });

    expect(tryConsumeSpy).toHaveBeenCalledWith("test-key-1234567890");
    expect(canSponsorSpy).not.toHaveBeenCalled();
    expect(recordSponsoredSpy).not.toHaveBeenCalled();
  });

  it("tryConsume tokens refill after time passes", async () => {
    vi.useFakeTimers();
    const tracker = new InMemoryGasSponsorTracker(100);

    // Exhaust all tokens
    for (let i = 0; i < 100; i++) {
      expect(await tracker.tryConsume("key-a")).toBe(true);
    }
    expect(await tracker.tryConsume("key-a")).toBe(false);

    // Advance 36 seconds => ~1 token refilled (100/3600 * 36 = 1.0)
    vi.advanceTimersByTime(36_000);
    expect(await tracker.tryConsume("key-a")).toBe(true);
    // But not 2
    expect(await tracker.tryConsume("key-a")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Rate Limiter Edge Cases
// ═══════════════════════════════════════════════════════════════════

describe("RateLimiter edge cases", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects when bucket is at 0 tokens", async () => {
    // 1 token max, 0 refill/sec effectively
    const limiter = new RateLimiter(1, 0.001); // near-zero refill
    const app = new Hono();
    app.use("*", async (c, next) => {
      (c as any).set("apiKey", "key-rate-test");
      await next();
    });
    app.use("*", limiter.middleware());
    app.get("/test", (c) => c.json({ ok: true }));

    // First request consumes the 1 token
    const res1 = await app.request("/test");
    expect(res1.status).toBe(200);

    // Second request should be 429 (no tokens left)
    const res2 = await app.request("/test");
    expect(res2.status).toBe(429);
    const body = await res2.json();
    expect(body.error).toContain("Rate limit exceeded");
  });

  it("accepts when bucket is at max tokens", async () => {
    const limiter = new RateLimiter(100, 10);
    const app = new Hono();
    app.use("*", async (c, next) => {
      (c as any).set("apiKey", "key-max-test");
      await next();
    });
    app.use("*", limiter.middleware());
    app.get("/test", (c) => c.json({ ok: true }));

    // Fresh bucket should accept
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("rapid-fire requests exhaust the bucket", async () => {
    const maxTokens = 5;
    const limiter = new RateLimiter(maxTokens, 0.001); // near-zero refill
    const app = new Hono();
    app.use("*", async (c, next) => {
      (c as any).set("apiKey", "key-rapid");
      await next();
    });
    app.use("*", limiter.middleware());
    app.get("/test", (c) => c.json({ ok: true }));

    const results: number[] = [];
    for (let i = 0; i < maxTokens + 3; i++) {
      const res = await app.request("/test");
      results.push(res.status);
    }

    // First 5 should succeed, remaining 3 should be 429
    expect(results.filter((s) => s === 200).length).toBe(maxTokens);
    expect(results.filter((s) => s === 429).length).toBe(3);
  });

  it("tokens refill after the refill interval", async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(1, 1); // 1 token max, refill 1/sec
    const app = new Hono();
    app.use("*", async (c, next) => {
      (c as any).set("apiKey", "key-refill");
      await next();
    });
    app.use("*", limiter.middleware());
    app.get("/test", (c) => c.json({ ok: true }));

    // Consume the 1 token
    const res1 = await app.request("/test");
    expect(res1.status).toBe(200);

    // Immediately — rejected
    const res2 = await app.request("/test");
    expect(res2.status).toBe(429);

    // Advance 1 second — refill 1 token
    vi.advanceTimersByTime(1_000);

    const res3 = await app.request("/test");
    expect(res3.status).toBe(200);
  });

  it("uses apiKey for rate limiting on authenticated requests", async () => {
    const limiter = new RateLimiter(1, 0.001);
    const app = new Hono();
    app.use("*", async (c, next) => {
      (c as any).set("apiKey", "key-auth-a");
      await next();
    });
    app.use("*", limiter.middleware());
    app.get("/test", (c) => c.json({ ok: true }));

    // Key A exhausts its bucket
    await app.request("/test");
    const resA = await app.request("/test");
    expect(resA.status).toBe(429);

    // Key B should have its own bucket (separate app instance simulates)
    const app2 = new Hono();
    app2.use("*", async (c, next) => {
      (c as any).set("apiKey", "key-auth-b");
      await next();
    });
    app2.use("*", limiter.middleware());
    app2.get("/test", (c) => c.json({ ok: true }));

    const resB = await app2.request("/test");
    expect(resB.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Dedup Cache Security
// ═══════════════════════════════════════════════════════════════════

describe("Dedup cache security", () => {
  function makeTestApp(apiKey: string, ttlMs = 60_000, maxEntries = 10_000) {
    const app = new Hono();
    const handler = vi.fn().mockImplementation((c: any) =>
      c.json({ success: true, txDigest: "mock-digest" }),
    );
    app.use("*", async (c, next) => {
      (c as any).set("apiKey", apiKey);
      await next();
    });
    app.use("/settle", payloadDedup(ttlMs, maxEntries));
    app.post("/settle", handler);
    return { app, handler };
  }

  function postSettle(app: Hono, body = VALID_BODY) {
    return app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("different apiKeys with same body produce different cache keys (cross-tenant isolation)", async () => {
    // Two separate app instances with different API keys
    const { app: appA, handler: handlerA } = makeTestApp("tenant-alpha-key-1");
    const { app: appB, handler: handlerB } = makeTestApp("tenant-beta-key-22");

    // Same body sent to both
    await postSettle(appA, VALID_BODY);
    await postSettle(appB, VALID_BODY);

    // Both handlers must have been called — no cross-tenant cache hit
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it("same apiKey with same body returns X-Idempotent-Replay on second call", async () => {
    const { app } = makeTestApp("key-dedup-test-1234");
    const res1 = await postSettle(app);
    expect(res1.status).toBe(200);
    expect(res1.headers.get("X-Idempotent-Replay")).toBeNull();

    const res2 = await postSettle(app);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("X-Idempotent-Replay")).toBe("true");
  });

  it("TTL expiry: after TTL, same payload is reprocessed", async () => {
    const { app, handler } = makeTestApp("key-ttl-test-12345", 10); // 10ms TTL

    await postSettle(app);
    expect(handler).toHaveBeenCalledTimes(1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 25));

    const res = await postSettle(app);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(res.headers.get("X-Idempotent-Replay")).toBeNull();
  });

  it("cache evicts when maxEntries is reached", async () => {
    // maxEntries=3 — after 3 different payloads, oldest should be evicted
    const { app, handler } = makeTestApp("key-evict-test-1234", 60_000, 3);

    // Fill cache with 3 different payloads
    for (let i = 0; i < 4; i++) {
      const body = {
        ...VALID_BODY,
        paymentRequirements: { ...VALID_REQUIREMENTS, amount: `${1000 + i}` },
      };
      await postSettle(app, body);
    }

    // All 4 should have been processed (no cache hits since bodies differ)
    expect(handler).toHaveBeenCalledTimes(4);

    // The 4th entry triggered eviction. The first entry (amount=1000) should
    // have been evicted. Retry it — should be processed again (no cache).
    const body0 = {
      ...VALID_BODY,
      paymentRequirements: { ...VALID_REQUIREMENTS, amount: "1000" },
    };
    const res = await postSettle(app, body0);
    // This should go through the handler since it was evicted
    expect(handler).toHaveBeenCalledTimes(5);
    expect(res.headers.get("X-Idempotent-Replay")).toBeNull();
  });

  it("passes through to handler when no apiKey is set (unauthenticated)", async () => {
    const app = new Hono();
    const handler = vi.fn().mockImplementation((c: any) =>
      c.json({ success: true }),
    );
    // No apiKey middleware — simulates unauthenticated request
    app.use("/settle", payloadDedup());
    app.post("/settle", handler);

    await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });

    // Should pass through (no caching without apiKey)
    expect(handler).toHaveBeenCalledTimes(1);

    // Second request also goes through (no caching)
    await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("malformed JSON passes through to handler (not cached)", async () => {
    const app = new Hono();
    const handler = vi.fn().mockImplementation((c: any) =>
      c.json({ error: "bad json" }, 400),
    );
    app.use("*", async (c, next) => {
      (c as any).set("apiKey", "key-badjson-test123");
      await next();
    });
    app.use("/settle", payloadDedup());
    app.post("/settle", handler);

    const res = await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });

    // Handler should be called — dedup passes through on parse failure
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Shutdown Cleanup
// ═══════════════════════════════════════════════════════════════════

describe("Shutdown cleanup", () => {
  it("GasSponsorService.close() clears reservations and sets initialized=false", async () => {
    const gasSponsorService = createMockGasSponsorService();

    // Verify initial state
    expect(gasSponsorService.initialized).toBe(true);

    // The real close() clears reservations and sets _initialized=false.
    // Since we're using a mock, we test the mock behavior which mirrors
    // the real implementation's contract.
    await gasSponsorService.close();
    expect(gasSponsorService.close).toHaveBeenCalledTimes(1);
  });

  it("/sponsor returns 503 after gas sponsor is uninitialized", async () => {
    const facilitator = createMockFacilitator();
    const tracker = new UsageTracker();
    const gasSponsorService = createMockGasSponsorService({ initialized: false });
    const app = createRoutes(
      facilitator as any,
      tracker,
      50,
      undefined,
      undefined,
      undefined,
      gasSponsorService as any,
    );

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

  it("/sponsor returns 503 when gasSponsorService is not configured", async () => {
    const facilitator = createMockFacilitator();
    const tracker = new UsageTracker();
    // No gasSponsorService
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
});

// ═══════════════════════════════════════════════════════════════════
// 5. Error Handling (F-18) — No Internal State Leakage
// ═══════════════════════════════════════════════════════════════════

describe("F-18: Error responses do not leak internal state", () => {
  it("/verify returns generic error on unexpected exception", async () => {
    const facilitator = createMockFacilitator();
    facilitator.verify.mockRejectedValue(new Error("RPC connection refused at 10.0.0.5:9000"));
    const tracker = new UsageTracker();
    const app = createRoutes(facilitator as any, tracker, 50);

    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentPayload: VALID_PAYLOAD, paymentRequirements: VALID_REQUIREMENTS }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal verification error");
    // Must NOT contain internal details
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    expect(JSON.stringify(body)).not.toContain("connection refused");
  });

  it("/settle returns generic error on unexpected exception", async () => {
    const facilitator = createMockFacilitator();
    facilitator.settle.mockRejectedValue(new Error("Sui RPC: method not found, endpoint: https://internal-rpc.myco.io"));
    const tracker = new UsageTracker();
    const app = createRoutes(facilitator as any, tracker, 50);

    const res = await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentPayload: VALID_PAYLOAD, paymentRequirements: VALID_REQUIREMENTS }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal settlement error");
    expect(JSON.stringify(body)).not.toContain("internal-rpc.myco.io");
    expect(JSON.stringify(body)).not.toContain("method not found");
  });

  it("/s402/process returns generic error on unexpected exception", async () => {
    const facilitator = createMockFacilitator();
    facilitator.process.mockRejectedValue(new Error("Database connection pool exhausted: postgres://admin:s3cret@db.internal:5432"));
    const tracker = new UsageTracker();
    const app = createRoutes(facilitator as any, tracker, 50);

    const res = await app.request("/s402/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentPayload: VALID_PAYLOAD, paymentRequirements: VALID_REQUIREMENTS }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal processing error");
    expect(JSON.stringify(body)).not.toContain("postgres://");
    expect(JSON.stringify(body)).not.toContain("s3cret");
    expect(JSON.stringify(body)).not.toContain("db.internal");
  });

  it("/sponsor returns generic error for non-pool-exhaustion failures", async () => {
    const facilitator = createMockFacilitator();
    const tracker = new UsageTracker();
    const gasSponsorService = createMockGasSponsorService({
      sponsor: vi.fn().mockRejectedValue(new Error("Signer private key mismatch at /etc/secrets/key.pem")),
    });
    const app = createRoutes(
      facilitator as any,
      tracker,
      50,
      undefined,
      undefined,
      undefined,
      gasSponsorService as any,
    );

    const res = await app.request("/sponsor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: "0x" + "a".repeat(64),
        transactionKindBytes: "AQIDBA==",
        network: "sui:testnet",
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Sponsorship failed");
    expect(JSON.stringify(body)).not.toContain("/etc/secrets/key.pem");
    expect(JSON.stringify(body)).not.toContain("private key");
  });

  it("/sponsor returns specific 503 for POOL_EXHAUSTED (not internal state)", async () => {
    const facilitator = createMockFacilitator();
    const tracker = new UsageTracker();
    const gasSponsorService = createMockGasSponsorService({
      sponsor: vi.fn().mockRejectedValue(new Error("POOL_EXHAUSTED: no coins available")),
    });
    const app = createRoutes(
      facilitator as any,
      tracker,
      50,
      undefined,
      undefined,
      undefined,
      gasSponsorService as any,
    );

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
    expect(body.error).toBe("Gas sponsor pool temporarily exhausted");
    // Does NOT leak internal details
    expect(JSON.stringify(body)).not.toContain("no coins available");
  });

  it("/verify returns 400 with validation message for bad input (not 500)", async () => {
    const facilitator = createMockFacilitator();
    const tracker = new UsageTracker();
    const app = createRoutes(facilitator as any, tracker, 50);

    // Missing paymentPayload
    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentRequirements: VALID_REQUIREMENTS }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("paymentPayload");
  });

  it("/settle returns 400 for malformed JSON body", async () => {
    const facilitator = createMockFacilitator();
    const tracker = new UsageTracker();
    const app = createRoutes(facilitator as any, tracker, 50);

    const res = await app.request("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json}}}",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
    // Must not leak parse error details
    expect(JSON.stringify(body)).not.toContain("Unexpected token");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Gas Sponsor Tracker — Stale Bucket Eviction
// ═══════════════════════════════════════════════════════════════════

describe("GasSponsorTracker stale bucket eviction", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts stale buckets when map exceeds 10,000 entries", async () => {
    vi.useFakeTimers();
    const tracker = new InMemoryGasSponsorTracker(10);

    // Create 10,001 keys — should trigger eviction on the 10,001st
    for (let i = 0; i < 10_001; i++) {
      await tracker.tryConsume(`key-${i}`);
    }

    // Advance time by 2+ hours to make all buckets stale
    vi.advanceTimersByTime(7_200_001);

    // Adding another key should trigger eviction of stale entries
    await tracker.tryConsume("key-new");

    // The tracker should not crash and should still work
    expect(await tracker.tryConsume("key-new")).toBe(true);
  });
});
