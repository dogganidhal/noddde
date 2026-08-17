#!/usr/bin/env node
// Fails CI when a spec is still `draft`/`ready` but its source_file(s) exist
// and are covered by a test suite that actually passes — i.e. the code
// shipped and got tested, but nobody bumped the spec's lifecycle status.
// A source file that doesn't exist yet, or whose tests fail/don't exist, is
// NOT a violation: the spec is correctly describing unfinished work.
import { readFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function extractField(frontmatter, name) {
  const inline = frontmatter.match(
    new RegExp(`^${name}:\\s*\\[([^\\]]*)\\]`, "m"),
  );
  if (inline) {
    return inline[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const block = frontmatter.match(
    new RegExp(`^${name}:\\s*\\n((?:  - .*\\n?)*)`, "m"),
  );
  if (block) {
    return [...block[1].matchAll(/^\s*-\s*(.+?)\s*$/gm)].map((m) => m[1]);
  }
  const scalar = frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  return scalar ? [scalar[1].trim().replace(/^["']|["']$/g, "")] : [];
}

function packageRootFor(sourceFile) {
  let dir = path.dirname(path.join(repoRoot, sourceFile));
  while (dir !== repoRoot && dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function findCoveringTests(sourceFile, pkgRoot, exportNames) {
  const srcPrefix = path.join(pkgRoot, "src") + path.sep;
  const fullSource = path.join(repoRoot, sourceFile);
  if (!fullSource.startsWith(srcPrefix)) return [];
  const relNoExt = fullSource.slice(srcPrefix.length).replace(/\.ts$/, "");

  // Known test-path shapes: plain (core/adapters/cli) and engine's extra
  // "engine/" segment (see specs/README.md's spec->test mapping table).
  const candidates = [
    path.join("src/__tests__", `${relNoExt}.test.ts`),
    path.join("src/__tests__/engine", `${relNoExt}.test.ts`),
  ];
  const found = candidates.filter((rel) => existsSync(path.join(pkgRoot, rel)));
  if (found.length > 0) return found;

  // Fallback: grep for the spec's primary exported symbol as a whole word.
  const primaryExport = exportNames[0];
  if (!primaryExport) return [];
  const testFiles = globSync("src/**/__tests__/**/*.test.ts", { cwd: pkgRoot });
  const wordRe = new RegExp(`\\b${primaryExport}\\b`);
  return testFiles.filter((rel) =>
    wordRe.test(readFileSync(path.join(pkgRoot, rel), "utf8")),
  );
}

const specFiles = globSync("specs/**/*.spec.md", { cwd: repoRoot });
const violations = [];

for (const rel of specFiles) {
  const content = readFileSync(path.join(repoRoot, rel), "utf8");
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) continue;

  const [status] = extractField(fm[1], "status");
  if (status !== "draft" && status !== "ready") continue;

  const sourceFiles = extractField(fm[1], "source_file");
  const exportNames = extractField(fm[1], "exports");
  for (const sourceFile of sourceFiles) {
    const fullSource = path.join(repoRoot, sourceFile);
    if (!existsSync(fullSource)) continue; // genuinely not implemented yet

    const pkgRoot = packageRootFor(sourceFile);
    if (!pkgRoot) continue;

    const testFiles = findCoveringTests(sourceFile, pkgRoot, exportNames);
    if (testFiles.length === 0) continue; // shipped but untested: status may still be honest

    let allPass = true;
    for (const testFile of testFiles) {
      try {
        execFileSync("npx", ["vitest", "run", testFile], {
          cwd: pkgRoot,
          env: { ...process.env, CODEARTIFACT_AUTH_TOKEN: "placeholder" },
          stdio: "pipe",
        });
      } catch {
        allPass = false;
        break;
      }
    }

    if (allPass) {
      violations.push({ spec: rel, status, sourceFile, testFiles });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `\nspec status-drift check: ${violations.length} spec(s) marked draft/ready with shipped, passing-tested code\n`,
  );
  for (const v of violations) {
    console.error(
      `  ${v.spec} (status: ${v.status}) -- ${v.sourceFile} passes ${v.testFiles.join(", ")}`,
    );
  }
  console.error(
    "\nFix: bump status to `implemented` (or `implementing` if still in progress).\n",
  );
  process.exit(1);
}

console.log(`spec status-drift check: OK (${specFiles.length} specs checked)`);
