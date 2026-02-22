import type { Context, MiddlewareHandler } from "hono";
import { createHash } from "node:crypto";

interface CacheEntry {
  response: unknown;
  status: number;
  expiresAt: number;
}

/**
 * Recursively sorts object keys to produce a canonical JSON representation.
 * Ensures {a:1, b:2} and {b:2, a:1} hash identically, catching clients
 * that retry with the same logical payload but different key ordering.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return (value as unknown[]).map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

/**
 * In-memory payload dedup middleware for settlement endpoints.
 *
 * Solves the network-timeout reliability problem: a client submits a payment,
 * the facilitator broadcasts it to Sui, but the HTTP response is lost before
 * the client receives it. On retry, instead of receiving a 500 ("tx already
 * exists" from Sui RPC), the client gets the original cached response with
 * X-Idempotent-Replay: true.
 *
 * Dedup key: SHA-256(apiKey + ":" + canonicalJSON(body))
 * Including the API key prevents cross-tenant cache collisions — two different
 * customers sending the same body must NOT share a cache entry.
 *
 * Only 2xx responses are cached:
 * - 4xx (validation errors): same payload → same error; caching adds no value
 * - 5xx (infrastructure errors): client should retry; do not block retries
 *
 * Body reads use c.req.json(). Hono caches body parses internally via
 * bodyCache, so downstream route handlers can still call c.req.json() safely.
 *
 * Phase 1 limitations:
 * - Store is lost on restart. Safe: Sui rejects duplicate signed transactions
 *   at the protocol level. Worst case post-restart: 500 instead of a cached 200.
 *   Phase 2: Redis-backed store for cross-instance + cross-restart persistence.
 * - Concurrent identical requests within a single event loop tick can both
 *   miss the cache before either response is stored. Node.js single-threaded
 *   event loop makes this extremely rare in practice. Phase 2: distributed lock.
 */
export function payloadDedup(ttlMs = 60_000, maxEntries = 10_000): MiddlewareHandler {
  const cache = new Map<string, CacheEntry>();

  function evict(): void {
    const now = Date.now();
    // Remove expired entries first
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    // If still over 80% capacity, evict oldest entries (Map preserves insertion order)
    if (cache.size > maxEntries * 0.8) {
      let toRemove = cache.size - Math.floor(maxEntries * 0.8);
      for (const key of cache.keys()) {
        if (toRemove-- <= 0) break;
        cache.delete(key);
      }
    }
  }

  return async function dedupMiddleware(c: Context, next) {
    // API key is set by apiKeyAuth middleware — dedup must run after auth
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apiKey = (c as any).get("apiKey") as string | undefined;
    if (!apiKey) return next();

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // Malformed JSON — pass through; route handler will produce the 400
      return next();
    }

    const canonical = JSON.stringify(canonicalize(body));
    const hash = createHash("sha256")
      .update(`${apiKey}:${canonical}`)
      .digest("hex");

    const now = Date.now();
    const cached = cache.get(hash);

    if (cached && cached.expiresAt > now) {
      // Cache hit — return stored response without touching the Sui RPC
      c.header("X-Idempotent-Replay", "true");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(cached.response, cached.status as any);
    }

    await next();

    // After the route handler runs, cache successful responses for future replays.
    // We only cache 2xx — errors should remain retryable.
    if (c.res.ok) {
      try {
        const responseBody = await c.res.clone().json();
        if (cache.size >= maxEntries) evict();
        cache.set(hash, {
          response: responseBody,
          status: c.res.status,
          expiresAt: now + ttlMs,
        });
      } catch {
        // Non-JSON response or clone failure — skip caching, not a fatal error
      }
    }
  };
}
