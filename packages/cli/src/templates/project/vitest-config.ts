/** Generates vitest.config.mts content. */
export function vitestConfigTemplate(): string {
  return `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
`;
}
