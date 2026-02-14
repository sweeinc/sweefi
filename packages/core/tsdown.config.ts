import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "x402/types": "src/x402/types.ts",
    "x402/client": "src/x402/client.ts",
    "x402/server": "src/x402/server.ts",
    "x402/facilitator": "src/x402/facilitator.ts",
    "s402/index": "src/s402/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
});
