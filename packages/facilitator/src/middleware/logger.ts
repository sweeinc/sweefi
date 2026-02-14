import type { Context, Next } from "hono";

/**
 * Structured JSON request logger.
 */
export function requestLogger() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;

    const log = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: duration,
      api_key: ((c.get("apiKey") as string | undefined)?.slice(0, 8) ?? "anonymous") + "...",
      timestamp: new Date().toISOString(),
    };

    console.log(JSON.stringify(log));
  };
}
