import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "client/index": "src/client/index.ts",
    "server/index": "src/server/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  // Source maps excluded from npm publish via .npmignore
  target: "es2020",
  clean: true,
});
