import type { Context, Next } from "hono";

/**
 * Bearer token API key authentication middleware.
 * Validates the Authorization header against a set of valid API keys.
 */
export function apiKeyAuth(validKeys: Set<string>) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const key = authHeader.slice(7);
    if (!validKeys.has(key)) {
      return c.json({ error: "Invalid API key" }, 403);
    }

    // Attach API key to context for metering
    c.set("apiKey", key);
    await next();
  };
}
