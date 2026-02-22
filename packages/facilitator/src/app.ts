import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createFacilitator } from "./facilitator";
import { createRoutes } from "./routes";
import { apiKeyAuth } from "./auth/api-key";
import { RateLimiter } from "./middleware/rate-limiter";
import { requestLogger } from "./middleware/logger";
import { payloadDedup } from "./middleware/dedup";
import { UsageTracker } from "./metering/usage-tracker";
import { meteringContext } from "./metering/hooks";
import type { Config } from "./config";

/** Default Sui RPC URLs used when custom ones are not configured in env. */
const DEFAULT_RPC_URLS: Record<string, string> = {
  "sui:testnet": "https://fullnode.testnet.sui.io:443",
  "sui:mainnet": "https://fullnode.mainnet.sui.io:443",
};

/**
 * Lightweight Sui RPC health check.
 *
 * Calls sui_getLatestCheckpointSequenceNumber — the cheapest possible RPC
 * call that proves the endpoint is reachable and responding to JSON-RPC.
 * 3-second timeout prevents /ready from hanging during Sui RPC outages.
 */
async function pingRpc(url: string): Promise<"ok" | "timeout" | "error"> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sui_getLatestCheckpointSequenceNumber",
        params: [],
      }),
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok ? "ok" : "error";
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") return "timeout";
    return "error";
  }
}

/**
 * Create the Hono application with all middleware and routes wired.
 * Separated from index.ts for testability.
 */
export function createApp(config: Config) {
  const facilitator = createFacilitator(config);
  const usageTracker = new UsageTracker();
  const serverStartTime = new Date();

  const app = new Hono();

  // ── Global middleware ────────────────────────────────────────────────────────
  app.use("*", bodyLimit({ maxSize: 256 * 1024 })); // 256 KB
  app.use("*", requestLogger());

  // ── Public endpoints (no auth) ───────────────────────────────────────────────
  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  /**
   * Readiness probe for orchestrators (Kubernetes, Fly.io).
   *
   * Distinct from /health (liveness): /ready confirms the facilitator can
   * actually settle payments, not just that the process is alive.
   *
   * Checks:
   * 1. Scheme registration — at least one payment scheme is registered per network.
   * 2. Sui RPC connectivity — each configured (or default) RPC endpoint responds
   *    to a lightweight JSON-RPC call within 3 seconds.
   *
   * Returns 200 when ready, 503 when any check fails.
   */
  app.get("/ready", async (c) => {
    const rpcUrls: Record<string, string> = {
      "sui:testnet": config.SUI_TESTNET_RPC ?? DEFAULT_RPC_URLS["sui:testnet"],
      "sui:mainnet": config.SUI_MAINNET_RPC ?? DEFAULT_RPC_URLS["sui:mainnet"],
    };

    const schemes: Record<string, string[]> = {};
    for (const network of Object.keys(rpcUrls)) {
      schemes[network] = facilitator.supportedSchemes(network);
    }
    const schemesReady = Object.values(schemes).some((s) => s.length > 0);

    // Ping all configured RPC endpoints in parallel
    const rpcResults: Record<string, string> = {};
    await Promise.all(
      Object.entries(rpcUrls).map(async ([network, url]) => {
        rpcResults[network] = await pingRpc(url);
      }),
    );
    const rpcReady = Object.values(rpcResults).every((r) => r === "ok");

    const ready = schemesReady && rpcReady;
    return c.json({ ready, checks: { schemes, rpc: rpcResults } }, ready ? 200 : 503);
  });

  // ── Protected routes ─────────────────────────────────────────────────────────
  const validKeys = new Set(config.API_KEYS.split(",").map((k) => k.trim()).filter((k) => k.length > 0));
  const rateLimiter = new RateLimiter(
    config.RATE_LIMIT_MAX_TOKENS,
    config.RATE_LIMIT_REFILL_RATE,
  );

  app.use("/verify", apiKeyAuth(validKeys));
  app.use("/settle", apiKeyAuth(validKeys));
  app.use("/supported", apiKeyAuth(validKeys));
  app.use("/settlements", apiKeyAuth(validKeys));
  app.use("/s402/*", apiKeyAuth(validKeys));

  // Metering context propagates API key for inline metering in route handlers.
  // Must be AFTER auth (needs apiKey) and BEFORE routes.
  app.use("/settle", meteringContext());
  app.use("/s402/process", meteringContext());

  // Payload dedup prevents duplicate settlement attempts caused by network
  // timeouts. Must be AFTER auth (needs apiKey to scope cache per-tenant) and
  // BEFORE the rate limiter (cache hits skip rate limit token consumption).
  app.use("/settle", payloadDedup());
  app.use("/s402/process", payloadDedup());

  app.use("*", rateLimiter.middleware());

  // Mount facilitator routes (verify, settle, supported, s402/process, settlements)
  const routes = createRoutes(facilitator, usageTracker, config.FEE_BPS, config.FEE_RECIPIENT, serverStartTime);
  app.route("/", routes);

  return { app, usageTracker };
}
