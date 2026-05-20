import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "node",
  splitting: false,
  // NestJS relies on decorator metadata at runtime; tsup reads these from tsconfig.
  tsconfig: "./tsconfig.json",
});
