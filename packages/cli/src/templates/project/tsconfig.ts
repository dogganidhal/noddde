/** Generates tsconfig.json content. */
export function tsconfigTemplate(): string {
  const config = {
    extends: "@noddde/typescript-config/base.json",
    compilerOptions: {
      outDir: "dist",
    },
    include: ["src"],
    exclude: ["node_modules", "dist", "src/__tests__"],
  };

  return JSON.stringify(config, null, 2) + "\n";
}
