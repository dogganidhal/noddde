#!/usr/bin/env node
// Fails CI when a spec's `docs:` frontmatter points at a page that doesn't
// exist under docs/content/docs/. An intentionally empty `docs: []` (used
// for modules that genuinely have no docs page yet) is not an error.
import { readFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const docsRoot = path.join(repoRoot, "docs/content/docs");

function extractDocsList(frontmatter) {
  const inline = frontmatter.match(/^docs:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const block = frontmatter.match(/^docs:\s*\n((?:  - .*\n?)*)/m);
  if (block) {
    return [...block[1].matchAll(/^\s*-\s*(.+?)\s*$/gm)].map((m) => m[1]);
  }
  return [];
}

const specFiles = globSync("specs/**/*.spec.md", { cwd: repoRoot });
const failures = [];

for (const rel of specFiles) {
  const full = path.join(repoRoot, rel);
  const content = readFileSync(full, "utf8");
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) {
    failures.push({ spec: rel, doc: null, reason: "no frontmatter found" });
    continue;
  }
  for (const doc of extractDocsList(fm[1])) {
    const normalized = doc.startsWith("docs/content/docs/")
      ? doc.slice("docs/content/docs/".length)
      : doc;
    if (!existsSync(path.join(docsRoot, normalized))) {
      failures.push({ spec: rel, doc, reason: "target page does not exist" });
    }
  }
}

if (failures.length > 0) {
  console.error(
    `\nspec docs link-check: ${failures.length} dangling docs: reference(s)\n`,
  );
  for (const f of failures) {
    console.error(`  ${f.spec} -> ${f.doc} (${f.reason})`);
  }
  console.error(
    "\nFix: point the docs: field at a real page under docs/content/docs/, " +
      "or use `docs: [] # TODO: no docs page yet` if none exists.\n",
  );
  process.exit(1);
}

console.log(`spec docs link-check: OK (${specFiles.length} specs checked)`);
