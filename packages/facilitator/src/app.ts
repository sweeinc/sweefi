import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createFacilitator } from "./facilitator";
import { createRoutes } from "./routes";
import { apiKeyAuth } from "./auth/api-key";
import { RateLimiter } from "./middleware/rate-limiter";
import { requestLogger } from "./middleware/logger";
import { payloadDedup } from "./middleware/dedup";
import { UsageTracker } from "./metering/usage-tracker";
import { InMemoryGasSponsorTracker } from "./metering/gas-sponsor-tracker";
import { meteringContext } from "./metering/hooks";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import type { Config } from "./config";

/**
 * Decode a facilitator keypair from bech32 (suiprivkey1...) or raw base64.
 * Returns undefined if the value is falsy or unparseable.
 */
function decodeKeypair(raw: string | undefined): Ed25519Keypair | undefined {
  if (!raw) return undefined;
  try {
    return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(raw).secretKey);
  } catch {
    try {
      return Ed25519Keypair.fromSecretKey(raw);
    } catch {
      return undefined;
    }
  }
}

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
  const { facilitator, gasSponsorService } = createFacilitator(config);
  const usageTracker = new UsageTracker();
  const gasSponsorTracker = new InMemoryGasSponsorTracker(config.GAS_SPONSOR_MAX_PER_HOUR);
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
   *
   * SECURITY (V8 audit F-03): Response is cached for 10 seconds to prevent
   * unauthenticated callers from using /ready as an RPC amplification vector.
   * Without caching, each request generates 2 outbound RPC calls to Sui fullnodes.
   */
  let readyCache: { result: Record<string, unknown>; ready: boolean; expiresAt: number } | null = null;

  app.get("/ready", async (c) => {
    const now = Date.now();
    if (readyCache && readyCache.expiresAt > now) {
      return c.json(readyCache.result, readyCache.ready ? 200 : 503);
    }

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
    const result = { ready, checks: { schemes, rpc: rpcResults } };

    readyCache = { result, ready, expiresAt: now + 10_000 };
    return c.json(result, ready ? 200 : 503);
  });

  /**
   * Fee schedule discovery endpoint (RFC 8615 well-known URI).
   *
   * Returns the facilitator's current fee schedule so API servers can
   * auto-discover payment terms before routing clients here. Clients MUST:
   *
   *   1. Use HTTPS only — never trust this over plaintext.
   *   2. Verify `issuer` matches the URL they fetched from (RFC 8414 pattern —
   *      prevents a MITM from returning a valid-looking response with a different
   *      `feeRecipient` address).
   *   3. Respect `validUntil` — stop trusting a cached schedule after it expires.
   *   4. If `signature` is present: verify it. Sign input is the canonical JSON
   *      of this document (keys sorted lexicographically, no whitespace) minus
   *      the `signature` and `publicKey` fields, using the facilitator's
   *      Ed25519 keypair. The `publicKey` field is the base64-encoded public key.
   *
   * Cache-Control: public, max-age=3600 — clients may cache for ≤1 hour.
   * `validUntil` is the authoritative expiry; the HTTP cache is a performance
   * layer only and must not be trusted past `validUntil`.
   *
   * References:
   *   RFC 8615 — Well-Known Uniform Resource Identifiers
   *   RFC 8414 — OAuth 2.0 Authorization Server Metadata (`issuer` pattern)
   *   IANA provisional registration: s402-facilitator (pending)
   *
   * Upgrade path: replace raw Ed25519 signature with JWS compact serialization
   * (panva/jose, RFC 7515) for `alg: EdDSA` standard compliance.
   */
  app.get("/.well-known/s402-facilitator", async (c) => {
    const now = Date.now();
    const origin = new URL(c.req.url).origin;

    // supportedSchemes per network — gather all supported chains
    const supportedNetworks: Record<string, string[]> = {};
    const allNetworks = [
      "sui:testnet", "sui:mainnet",
      "solana:devnet", "solana:mainnet-beta",
    ];
    for (const network of allNetworks) {
      const schemes = facilitator.supportedSchemes(network);
      if (schemes.length > 0) supportedNetworks[network] = schemes;
    }

    const schedule: Record<string, unknown> = {
      version: "1",
      // SECURITY: Clients MUST verify issuer === URL they fetched from (RFC 8414 §3).
      issuer: origin,
      // feeBps is the industry-standard representation (0–10 000; 10 000 = 100%).
      // Derived from FEE_MICRO_PERCENT (0–1 000 000) by dividing by 100.
      feeBps: Math.round(config.FEE_MICRO_PERCENT / 100),
      // feeMicroPercent is the native s402 on-chain unit. Exposed for integrators
      // building PTBs directly — avoids a unit conversion on the hot path.
      feeMicroPercent: config.FEE_MICRO_PERCENT,
      feeRecipient: config.FEE_RECIPIENT ?? null,
      supportedNetworks,
      // validFrom + validUntil bracket the schedule window. Clients SHOULD
      // re-fetch after validUntil. Cache-Control max-age ensures CDN eviction
      // within 1 hour even if validUntil is farther in the future.
      validFrom: new Date(now).toISOString(),
      validUntil: new Date(now + 24 * 60 * 60 * 1000).toISOString(), // 24 h
      docsUrl: "https://sweefi.xyz/docs/facilitator",
    };

    // Optional Ed25519 signature over the canonical schedule.
    // Canonical form: JSON.stringify with sorted keys, no whitespace, excluding
    // `signature` and `publicKey`. Clients verify using `publicKey` below.
    const keypair = decodeKeypair(config.FACILITATOR_KEYPAIR);
    if (keypair) {
      try {
        const canonical = JSON.stringify(
          schedule,
          Object.keys(schedule).sort(),
        );
        const sigBytes = await keypair.sign(new TextEncoder().encode(canonical));
        schedule.signature = Buffer.from(sigBytes).toString("base64");
        schedule.publicKey = keypair.getPublicKey().toBase64();
      } catch {
        // Signing failure must not block fee schedule delivery.
        // Operators can diagnose via LOG_LEVEL=debug.
      }
    }

    c.header("Cache-Control", "public, max-age=3600, must-revalidate");
    return c.json(schedule);
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
  app.use("/sponsor", apiKeyAuth(validKeys));

  // Metering context propagates API key for inline metering in route handlers.
  // Must be AFTER auth (needs apiKey) and BEFORE routes.
  app.use("/settle", meteringContext());
  app.use("/s402/process", meteringContext());

  // Payload dedup prevents duplicate settlement attempts caused by network
  // timeouts. Must be AFTER auth (needs apiKey to scope cache per-tenant) and
  // BEFORE the rate limiter (cache hits skip rate limit token consumption).
  app.use("/settle", payloadDedup());
  app.use("/s402/process", payloadDedup());

  // General rate limiter applies to all authenticated routes including /sponsor.
  // /sponsor is intentionally double-gated: this general limiter provides DoS
  // protection (requests/second), while gasSponsorTracker.tryConsume() in the
  // route handler enforces the gas sponsorship budget (requests/hour per key).
  // The two limits serve different purposes and should both remain.
  app.use("*", rateLimiter.middleware());

  // Mount facilitator routes (verify, settle, supported, s402/process, settlements, sponsor)
  const routes = createRoutes(facilitator, usageTracker, config.FEE_MICRO_PERCENT, config.FEE_RECIPIENT, serverStartTime, gasSponsorTracker, gasSponsorService);
  app.route("/", routes);

  return { app, usageTracker, gasSponsorService };
}
