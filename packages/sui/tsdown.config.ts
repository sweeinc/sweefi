import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "ptb/index": "src/ptb/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
});
