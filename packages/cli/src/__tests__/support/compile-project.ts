import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Walks up from this module's location to find the monorepo root — the
 * directory whose `package.json` declares yarn workspaces. Used to locate
 * the already-built `node_modules` (real `@noddde/*` packages + hoisted
 * third-party deps) that scaffolded projects are checked against.
 */
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf-8"),
      ) as {
        workspaces?: unknown;
      };
      if (pkg.workspaces) return dir;
    } catch {
      // Not the root — keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not locate the monorepo root (package.json with workspaces)",
  );
}

/**
 * Symlinks `projectDir/node_modules` to the monorepo root's `node_modules`.
 * The root already contains yarn-workspace symlinks for every `@noddde/*`
 * package (pointing at their real, built `dist/`) plus every hoisted
 * third-party dependency (kafkajs, drizzle-orm, typeorm, etc.) — so a
 * scaffolded project resolves imports against the real framework API
 * without a real `npm install`.
 */
export async function linkWorkspaceNodeModules(
  projectDir: string,
): Promise<void> {
  const repoRoot = findRepoRoot();
  await symlink(
    path.join(repoRoot, "node_modules"),
    path.join(projectDir, "node_modules"),
    "dir",
  );
}

export interface TypecheckResult {
  ok: boolean;
  output: string;
}

/** Runs `tsc --noEmit -p <projectDir>` using the monorepo's own TypeScript install. */
export async function typecheckProject(
  projectDir: string,
): Promise<TypecheckResult> {
  const repoRoot = findRepoRoot();
  const tscBin = path.join(repoRoot, "node_modules", ".bin", "tsc");
  try {
    const { stdout, stderr } = await execFileAsync(
      tscBin,
      ["--noEmit", "-p", projectDir],
      {
        cwd: projectDir,
      },
    );
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (err) {
    const execErr = err as {
      stdout?: string;
      stderr?: string;
      message: string;
    };
    return {
      ok: false,
      output: `${execErr.stdout ?? ""}${execErr.stderr ?? execErr.message}`,
    };
  }
}
