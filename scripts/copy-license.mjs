#!/usr/bin/env node
/**
 * Copies the repo-root LICENSE into every published package directory.
 *
 * `npm pack` never includes the root LICENSE for a workspace package unless
 * a copy lives inside that package's own directory (npm auto-includes
 * `LICENSE*` regardless of the `files` allowlist, but only from the package
 * root it's about to pack). Run before `changeset publish` so every tarball
 * ships the MIT license text its own `package.json` declares.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const license = readFileSync(path.join(repoRoot, "LICENSE"), "utf-8");

function findPackageDirs(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const pkgJsonPath = path.join(full, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      if (!pkg.private) result.push(full);
    } catch {
      // No package.json here — recurse (e.g. packages/adapters/*).
      result.push(...findPackageDirs(full));
    }
  }
  return result;
}

const packageDirs = [
  ...findPackageDirs(path.join(repoRoot, "packages")),
];

for (const dir of packageDirs) {
  writeFileSync(path.join(dir, "LICENSE"), license);
  console.log(`  Copied LICENSE -> ${path.relative(repoRoot, dir)}`);
}
