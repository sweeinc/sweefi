import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const { app } = createApp(config);

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`swee-facilitator listening on http://localhost:${info.port}`);
});
