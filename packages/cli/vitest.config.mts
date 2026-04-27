import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    // Diagram tests build a real ts.Program (multi-second on CI). Bump
    // both per-test and hook budgets so the suite has headroom on slow
    // GitHub-Actions runners.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
