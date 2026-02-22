import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { payloadDedup } from "../src/middleware/dedup";

const TEST_PAYLOAD = {
  paymentPayload: { scheme: "exact", payload: { transaction: "abc", signature: "def" } },
  paymentRequirements: { network: "sui:testnet", amount: "1000000", payTo: "0x" + "b".repeat(64) },
};

/**
 * Build a minimal Hono app with dedup middleware and a stubbed settle handler.
 * The handler mock lets us verify how many times the actual route logic ran.
 */
function makeTestApp(apiKey: string, ttlMs = 60_000) {
  const app = new Hono();
  const handler = vi.fn().mockImplementation((c: any) =>
    c.json({ success: true, txDigest: "mock-digest" }),
  );

  // Inject apiKey as auth middleware would in production
  app.use("*", async (c, next) => {
    (c as any).set("apiKey", apiKey);
    await next();
  });
  app.use("/settle", payloadDedup(ttlMs));
  app.post("/settle", handler);

  return { app, handler };
}

function postSettle(app: Hono, body = TEST_PAYLOAD) {
  return app.request("/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("payloadDedup middleware", () => {
  describe("cache miss — first request", () => {
    it("passes through to the route handler and returns 200", async () => {
      const { app } = makeTestApp("key-a");
      const res = await postSettle(app);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.txDigest).toBe("mock-digest");
    });

    it("does NOT set X-Idempotent-Replay on the first request", async () => {
      const { app } = makeTestApp("key-a");
      const res = await postSettle(app);
      expect(res.headers.get("X-Idempotent-Replay")).toBeNull();
    });
  });

  describe("cache hit — duplicate request within TTL", () => {
    it("returns the cached response without calling the handler again", async () => {
      const { app, handler } = makeTestApp("key-a");

      await postSettle(app); // first — populates cache
      const res2 = await postSettle(app); // second — cache hit

      expect(res2.status).toBe(200);
      const body = await res2.json();
      expect(body.txDigest).toBe("mock-digest");
      // Handler should only have been called once
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("sets X-Idempotent-Replay: true on the cached response", async () => {
      const { app } = makeTestApp("key-a");
      await postSettle(app);
      const res2 = await postSettle(app);
      expect(res2.headers.get("X-Idempotent-Replay")).toBe("true");
    });
  });

  describe("cross-tenant isolation", () => {
    it("does NOT share cache entries between different API keys", async () => {
      // Two separate apps (different API keys) with the same handler mock
      const { app: appA, handler: handlerA } = makeTestApp("key-a");
      const { app: appB, handler: handlerB } = makeTestApp("key-b");

      // Both send the identical payload
      await postSettle(appA);
      await postSettle(appB);

      // Each handler should have been called exactly once — no cross-tenant cache hit
      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledTimes(1);

      // Second request for key-b should be a cache hit within key-b's own cache
      const res2B = await postSettle(appB);
      expect(res2B.headers.get("X-Idempotent-Replay")).toBe("true");
      // key-b handler still called only once
      expect(handlerB).toHaveBeenCalledTimes(1);
    });
  });

  describe("TTL expiry", () => {
    it("re-processes the request after the TTL expires", async () => {
      // 10ms TTL so we can expire it quickly in tests
      const { app, handler } = makeTestApp("key-a", 10);

      await postSettle(app); // first request — populates cache
      expect(handler).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      const res2 = await postSettle(app); // after TTL — should re-process
      expect(handler).toHaveBeenCalledTimes(2);
      expect(res2.headers.get("X-Idempotent-Replay")).toBeNull();
    });
  });

  describe("error response handling", () => {
    it("does NOT cache 4xx error responses", async () => {
      const app = new Hono();
      const handler = vi.fn()
        .mockImplementationOnce((c: any) => c.json({ error: "bad request" }, 400))
        .mockImplementationOnce((c: any) => c.json({ success: true, txDigest: "mock-digest" }));

      app.use("*", async (c, next) => { (c as any).set("apiKey", "key-a"); await next(); });
      app.use("/settle", payloadDedup());
      app.post("/settle", handler);

      const res1 = await postSettle(app);
      expect(res1.status).toBe(400);

      // Second request should NOT be a cache hit — 4xx was not cached
      const res2 = await postSettle(app);
      expect(res2.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("does NOT cache 5xx error responses", async () => {
      const app = new Hono();
      const handler = vi.fn()
        .mockImplementationOnce((c: any) => c.json({ error: "rpc down" }, 500))
        .mockImplementationOnce((c: any) => c.json({ success: true, txDigest: "mock-digest" }));

      app.use("*", async (c, next) => { (c as any).set("apiKey", "key-a"); await next(); });
      app.use("/settle", payloadDedup());
      app.post("/settle", handler);

      const res1 = await postSettle(app);
      expect(res1.status).toBe(500);

      // Retry should re-process, not return cached 500
      const res2 = await postSettle(app);
      expect(res2.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe("canonical body normalization", () => {
    it("treats payloads with different key ordering as identical", async () => {
      const { app, handler } = makeTestApp("key-a");

      // First request
      await app.request("/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentRequirements: TEST_PAYLOAD.paymentRequirements, paymentPayload: TEST_PAYLOAD.paymentPayload }),
      });

      // Second request with reversed key order — should be a cache hit
      const res2 = await app.request("/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPayload: TEST_PAYLOAD.paymentPayload, paymentRequirements: TEST_PAYLOAD.paymentRequirements }),
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(res2.headers.get("X-Idempotent-Replay")).toBe("true");
    });
  });
});
