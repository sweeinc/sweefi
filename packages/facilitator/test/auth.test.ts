import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { apiKeyAuth } from "../src/auth/api-key";

function createTestApp(validKeys: Set<string>) {
  const app = new Hono();
  app.use("*", apiKeyAuth(validKeys));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("apiKeyAuth", () => {
  const validKeys = new Set(["key-1", "key-2"]);

  it("returns 401 without Authorization header", async () => {
    const app = createTestApp(validKeys);
    const res = await app.request("/test");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authorization");
  });

  it("returns 401 with non-Bearer auth", async () => {
    const app = createTestApp(validKeys);
    const res = await app.request("/test", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 with invalid API key", async () => {
    const app = createTestApp(validKeys);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer invalid-key" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  it("passes with valid API key", async () => {
    const app = createTestApp(validKeys);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer key-1" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("accepts any valid key from the set", async () => {
    const app = createTestApp(validKeys);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer key-2" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects empty Bearer token", async () => {
    const app = createTestApp(validKeys);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer " },
    });
    // "Bearer " with nothing after is malformed — should be 401 or 403
    expect([401, 403]).toContain(res.status);
  });
});
