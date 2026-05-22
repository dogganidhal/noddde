import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@noddde/core": path.resolve(__dirname, "../../core/src/index.ts"),
      "@noddde/engine": path.resolve(__dirname, "../../engine/src/index.ts"),
      "@noddde/nats": path.resolve(__dirname, "src/index.ts"),
    },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["src/__tests__/**/*.integration.test.ts", "node_modules/**"],
  },
});
