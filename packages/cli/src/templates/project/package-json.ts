import type { TemplateContext } from "../../utils/context.js";
import type { PersistenceAdapter } from "../../utils/persistence.js";

/** Generates package.json content with correct deps for the chosen persistence adapter. */
export function packageJsonTemplate(
  ctx: TemplateContext,
  adapter: PersistenceAdapter,
): string {
  const deps: Record<string, string> = {
    "@noddde/core": "^0.0.0",
    "@noddde/engine": "^0.0.0",
  };

  const devDeps: Record<string, string> = {
    "@noddde/testing": "^0.0.0",
    "@noddde/typescript-config": "^0.0.0",
    "@types/node": "^20.11.17",
    eslint: "^8.56.0",
    tsx: "^4.21.0",
    typescript: "^5.3.3",
    vitest: "^4.1.0",
  };

  if (adapter === "prisma") {
    deps["@noddde/prisma"] = "^0.0.0";
    deps["@prisma/client"] = "^6.5.0";
    devDeps["prisma"] = "^6.5.0";
  } else if (adapter === "drizzle") {
    deps["@noddde/drizzle"] = "^0.0.0";
    deps["drizzle-orm"] = "^0.40.0";
    deps["better-sqlite3"] = "^11.0.0";
    devDeps["@types/better-sqlite3"] = "^7.6.13";
  } else if (adapter === "typeorm") {
    deps["@noddde/typeorm"] = "^0.0.0";
  }

  const sortedDeps = Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)),
  );
  const sortedDevDeps = Object.fromEntries(
    Object.entries(devDeps).sort(([a], [b]) => a.localeCompare(b)),
  );

  const pkg = {
    name: ctx.kebabName,
    version: "0.0.0",
    private: true,
    scripts: {
      build: "tsc",
      lint: "eslint . --max-warnings 0",
      start: "tsx src/main.ts",
      test: "vitest run",
      "test:watch": "vitest",
    },
    dependencies: sortedDeps,
    devDependencies: sortedDevDeps,
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}
