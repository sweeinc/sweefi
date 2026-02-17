import type { Context, Next } from "hono";
import { timingSafeEqual, createHash } from "node:crypto";

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses SHA-256 hashing so both sides are always the same length,
 * preventing length-oracle side-channel leaks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Bearer token API key authentication middleware.
 * Validates the Authorization header against a set of valid API keys.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function apiKeyAuth(validKeys: Set<string>) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const key = authHeader.slice(7);
    // Always iterate ALL keys to prevent timing side-channel that leaks
    // key position or set size. Do NOT use .some() — it short-circuits.
    let isValid = false;
    for (const k of validKeys) {
      if (constantTimeCompare(key, k)) isValid = true;
    }
    if (!isValid) {
      return c.json({ error: "Invalid API key" }, 403);
    }

    // Attach API key to context for metering
    c.set("apiKey", key);
    await next();
  };
}
