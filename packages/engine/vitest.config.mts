import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@noddde/engine": path.resolve(__dirname, "src/index.ts"),
      "@noddde/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
