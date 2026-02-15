import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "exact/client/index": "src/exact/client/index.ts",
    "exact/server/index": "src/exact/server/index.ts",
    "exact/facilitator/index": "src/exact/facilitator/index.ts",
    "prepaid/client/index": "src/prepaid/client/index.ts",
    "prepaid/server/index": "src/prepaid/server/index.ts",
    "prepaid/facilitator/index": "src/prepaid/facilitator/index.ts",
    "ptb/index": "src/ptb/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
});
