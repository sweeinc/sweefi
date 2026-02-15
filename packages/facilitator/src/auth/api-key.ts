import type { Context, Next } from "hono";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
    const isValid = [...validKeys].some((k) => constantTimeCompare(key, k));
    if (!isValid) {
      return c.json({ error: "Invalid API key" }, 403);
    }

    // Attach API key to context for metering
    c.set("apiKey", key);
    await next();
  };
}
