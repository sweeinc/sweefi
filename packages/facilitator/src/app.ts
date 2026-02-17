import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createFacilitator } from "./facilitator";
import { createRoutes } from "./routes";
import { apiKeyAuth } from "./auth/api-key";
import { RateLimiter } from "./middleware/rate-limiter";
import { requestLogger } from "./middleware/logger";
import { UsageTracker } from "./metering/usage-tracker";
import { meteringContext } from "./metering/hooks";
import type { Config } from "./config";

/**
 * Create the Hono application with all middleware and routes wired.
 * Separated from index.ts for testability.
 */
export function createApp(config: Config) {
  const facilitator = createFacilitator(config);
  const usageTracker = new UsageTracker();

  const app = new Hono();

  // Global middleware
  app.use("*", bodyLimit({ maxSize: 256 * 1024 })); // 256 KB
  app.use("*", requestLogger());

  // Health check (no auth required)
  app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

  // Protected routes require auth + rate limiting
  const validKeys = new Set(config.API_KEYS.split(",").map((k) => k.trim()).filter((k) => k.length > 0));
  const rateLimiter = new RateLimiter();

  app.use("/verify", apiKeyAuth(validKeys));
  app.use("/settle", apiKeyAuth(validKeys));
  app.use("/supported", apiKeyAuth(validKeys));
  app.use("/s402/*", apiKeyAuth(validKeys));

  // Metering context propagates API key for inline metering in route handlers.
  // Must be AFTER auth (needs apiKey) and BEFORE routes.
  app.use("/settle", meteringContext());
  app.use("/s402/process", meteringContext());

  app.use("*", rateLimiter.middleware());

  // Mount facilitator routes (verify, settle, supported, s402/process)
  const routes = createRoutes(facilitator, usageTracker, config.FEE_BPS);
  app.route("/", routes);

  return { app, usageTracker };
}
