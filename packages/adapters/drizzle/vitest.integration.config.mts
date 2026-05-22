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
    // Containers are slow to provision. Per-test 30s is enough for SQL ops once
    // the container is up, but the suite-level hooks themselves can need ~60s.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Each integration file spawns its own container — running them in
    // parallel quickly saturates CPU/RAM on CI. Keep it serial per file.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
