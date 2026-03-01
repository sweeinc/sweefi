import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const { app } = createApp(config);

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
