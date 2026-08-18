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
  // DrizzleAdvisoryLocker.fromUrl lazily `require()`s "pg"/"mysql2"/
  // "drizzle-orm/*" so importing this package doesn't force those drivers as
  // hard dependencies. The CJS build has a native, module-relative `require`;
  // the ESM build has none, so inject a module-relative one via
  // createRequire(import.meta.url) (mirrors @noddde/prisma's tsup config).
  banner: ({ format }) =>
    format === "esm"
      ? {
          js: "import { createRequire as __nodddeCreateRequire } from 'module'; const require = __nodddeCreateRequire(import.meta.url);",
        }
      : {},
});
