import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const { app, gasSponsorService } = createApp(config);

// Initialize gas sponsor pool before accepting requests.
// The pool needs to split coins from the sponsor's wallet, which requires
// RPC calls. Do this async — the server starts immediately, /sponsor returns
// 503 until initialization completes.
if (gasSponsorService) {
  gasSponsorService.initialize().catch((err) => {
    console.error("[gas-service] Failed to initialize gas sponsor pool:", err);
    console.error("[gas-service] Gas sponsorship will be unavailable. Fix the sponsor keypair/balance and restart.");
  });
}

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`swee-facilitator listening on http://localhost:${info.port}`);
});

function shutdown() {
  console.log("swee-facilitator shutting down...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
