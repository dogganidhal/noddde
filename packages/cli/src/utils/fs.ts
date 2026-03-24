import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

/** Creates a directory recursively if it doesn't exist. */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * Writes a file only if it does not already exist.
 * Returns true if the file was created, false if it was skipped.
 */
export async function writeFileIfNotExists(
  filePath: string,
  content: string,
): Promise<boolean> {
  try {
    await access(filePath);
    return false;
  } catch {
    await ensureDir(path.dirname(filePath));
    await writeFile(filePath, content, "utf-8");
    return true;
  }
}
