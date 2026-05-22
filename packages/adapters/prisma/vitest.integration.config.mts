import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@noddde/core": path.resolve(__dirname, "../../core/src/index.ts"),
      "@noddde/engine": path.resolve(__dirname, "../../engine/src/index.ts"),
      "@noddde/testing-integration": path.resolve(
        __dirname,
        "../../testing-integration/src/index.ts",
      ),
    },
  },
  test: {
    include: ["src/__tests__/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
