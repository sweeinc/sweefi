import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
  },
  plugins: [tsconfigPaths() as any],
});
