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
  // The advisory locker lazily `require("@prisma/client")` so importing the
  // package doesn't force a generated Prisma client. The CJS build has a
  // native, module-relative `require`; the ESM build has none, so inject a
  // module-relative one via createRequire(import.meta.url). This keeps
  // resolution relative to this module (not the process CWD).
  banner: ({ format }) =>
    format === "esm"
      ? {
          js: "import { createRequire as __nodddeCreateRequire } from 'module'; const require = __nodddeCreateRequire(import.meta.url);",
        }
      : {},
});
