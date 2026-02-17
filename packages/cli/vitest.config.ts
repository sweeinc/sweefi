import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // s402 is a workspace-linked package; help Vite resolve it
      s402: path.resolve(__dirname, "../core/node_modules/s402/dist/index.mjs"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
