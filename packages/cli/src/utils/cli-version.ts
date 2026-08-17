import { readFileSync } from "node:fs";
import path from "node:path";

interface OwnPackageJson {
  name: string;
  version: string;
}

/**
 * Walks up from this module's own location to find `@noddde/cli`'s
 * package.json. Works both from source (during tests) and from the
 * tsup-bundled `dist/index.js` (published), since it doesn't assume a
 * fixed directory depth — only that a `package.json` named `@noddde/cli`
 * exists somewhere above this file. Uses `__dirname` (not `import.meta.url`)
 * so this file can build into both the CJS and ESM bundles tsup emits —
 * `shims: true` in tsup.config.ts polyfills `__dirname` for the ESM output.
 */
function findOwnPackageJson(): OwnPackageJson {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "package.json");
    try {
      const pkg = JSON.parse(
        readFileSync(candidate, "utf-8"),
      ) as OwnPackageJson;
      if (pkg.name === "@noddde/cli") return pkg;
    } catch {
      // Not found at this level — keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate @noddde/cli's own package.json");
}

let cachedVersion: string | undefined;

/** The CLI's own published version (e.g. `"1.0.0"`), read from its package.json. */
export function getCliVersion(): string {
  if (!cachedVersion) {
    cachedVersion = findOwnPackageJson().version;
  }
  return cachedVersion;
}

/** The CLI's own major version number, used to anchor generated dependency ranges. */
export function getCliMajorVersion(): number {
  const version = getCliVersion();
  const major = version.split(".")[0];
  const parsed = Number(major);
  return Number.isNaN(parsed) ? 0 : parsed;
}
