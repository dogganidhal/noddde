/**
 * Generates tsconfig.json content. Inlines the framework's base compiler
 * options rather than extending `@noddde/typescript-config` — that package
 * is `private: true` and never published, so a generated project could
 * never resolve it outside the monorepo.
 */
export function tsconfigTemplate(): string {
  const config = {
    compilerOptions: {
      declaration: true,
      declarationMap: true,
      esModuleInterop: true,
      incremental: false,
      isolatedModules: true,
      lib: ["es2022", "DOM", "DOM.Iterable"],
      module: "NodeNext",
      moduleDetection: "force",
      moduleResolution: "NodeNext",
      noUncheckedIndexedAccess: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      strict: true,
      target: "ES2022",
      outDir: "dist",
    },
    include: ["src"],
    exclude: ["node_modules", "dist", "src/__tests__"],
  };

  return JSON.stringify(config, null, 2) + "\n";
}
