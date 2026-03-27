import { access } from "node:fs/promises";
import path from "node:path";

/**
 * Expected base paths for each generator within a noddde project.
 * Resolved relative to cwd.
 */
const STRUCTURE_PATHS = {
  aggregate: "src/domain/write-model/aggregates",
  projection: "src/domain/read-model/projections",
  saga: "src/domain/process-model",
} as const;

/**
 * Resolves the target directory for a generator by checking that the
 * expected project structure exists from the current working directory.
 *
 * @throws If the expected directory does not exist.
 */
export async function resolveProjectPath(
  kind: keyof typeof STRUCTURE_PATHS,
): Promise<string> {
  const expectedDir = path.resolve(process.cwd(), STRUCTURE_PATHS[kind]);
  try {
    await access(expectedDir);
  } catch {
    throw new Error(
      `Directory "${STRUCTURE_PATHS[kind]}" not found.\n` +
        `Run this command from your project root, or scaffold a project first with:\n\n` +
        `  noddde new project <name>\n`,
    );
  }
  return expectedDir;
}
