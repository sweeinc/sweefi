import type { Context, Next } from "hono";
import { createHash } from "node:crypto";

/**
 * Structured JSON request logger.
 */
export function requestLogger() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;

    const apiKey = c.get("apiKey") as string | undefined;
    const log = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: duration,
      api_key: apiKey
        ? createHash("sha256").update(apiKey).digest("hex").slice(0, 8)
        : "anonymous",
      timestamp: new Date().toISOString(),
    };

    console.log(JSON.stringify(log));
  };
}
