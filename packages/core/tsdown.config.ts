import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "s402/index": "src/s402/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
});
