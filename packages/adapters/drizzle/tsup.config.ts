import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "sqlite/schema": "src/sqlite/schema.ts",
    "pg/schema": "src/pg/schema.ts",
    "mysql/schema": "src/mysql/schema.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "node",
  splitting: false,
});
