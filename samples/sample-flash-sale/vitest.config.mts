import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@noddde/testing": path.resolve(__dirname, "../../packages/testing/src/index.ts"),
      "@noddde/engine": path.resolve(__dirname, "../../packages/engine/src/index.ts"),
      "@noddde/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
