import { readFile, writeFile } from "node:fs/promises";

/**
 * Reads a file, finds a marker line (string or regex), and inserts content
 * before it, preserving the marker line's indentation.
 *
 * @returns Whether the insertion was made and whether fallback was used.
 */
export async function insertBeforeMarker(
  filePath: string,
  marker: string | RegExp,
  content: string,
  options?: { fallbackAppend?: boolean },
): Promise<{ inserted: boolean; usedFallback: boolean }> {
  const fileContent = await readFile(filePath, "utf-8");
  const lines = fileContent.split("\n");

  const markerIndex = lines.findIndex((line) =>
    typeof marker === "string" ? line.includes(marker) : marker.test(line),
  );

  if (markerIndex !== -1) {
    const markerLine = lines[markerIndex]!;
    const indent = markerLine.match(/^(\s*)/)?.[1] ?? "";
    const indentedContent = content
      .split("\n")
      .map((l) => (l.trim() ? indent + l.trimStart() : l))
      .join("\n");
    lines.splice(markerIndex, 0, indentedContent);
    await writeFile(filePath, lines.join("\n"), "utf-8");
    return { inserted: true, usedFallback: false };
  }

  if (options?.fallbackAppend) {
    const trimmed = fileContent.trimEnd();
    await writeFile(filePath, trimmed + "\n" + content + "\n", "utf-8");
    return { inserted: true, usedFallback: true };
  }

  return { inserted: false, usedFallback: false };
}

/**
 * Inserts content after the last line matching a pattern.
 * Useful for appending entries to object literals like `decide: { ... }`.
 */
export async function insertAfterLastMatch(
  filePath: string,
  pattern: string | RegExp,
  content: string,
): Promise<boolean> {
  const fileContent = await readFile(filePath, "utf-8");
  const lines = fileContent.split("\n");

  let lastIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (
      typeof pattern === "string" ? line.includes(pattern) : pattern.test(line)
    ) {
      lastIndex = i;
    }
  }

  if (lastIndex === -1) return false;

  const matchedLine = lines[lastIndex]!;
  const indent = matchedLine.match(/^(\s*)/)?.[1] ?? "";
  const indentedContent = content
    .split("\n")
    .map((l) => (l.trim() ? indent + l.trimStart() : l))
    .join("\n");
  lines.splice(lastIndex + 1, 0, indentedContent);
  await writeFile(filePath, lines.join("\n"), "utf-8");
  return true;
}

/**
 * Appends an export line to a barrel file (before the final newline).
 */
export async function appendToBarrel(
  filePath: string,
  exportLine: string,
): Promise<void> {
  const fileContent = await readFile(filePath, "utf-8");
  const trimmed = fileContent.trimEnd();
  await writeFile(filePath, trimmed + "\n" + exportLine + "\n", "utf-8");
}

/**
 * Inserts import lines after the last existing import statement in a file.
 */
export async function insertImports(
  filePath: string,
  importLines: string,
): Promise<void> {
  const fileContent = await readFile(filePath, "utf-8");
  const lines = fileContent.split("\n");

  let lastImportIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith("import ")) {
      lastImportIndex = i;
    }
  }

  if (lastImportIndex === -1) {
    // No imports found — prepend
    await writeFile(filePath, importLines + "\n" + fileContent, "utf-8");
  } else {
    lines.splice(lastImportIndex + 1, 0, importLines);
    await writeFile(filePath, lines.join("\n"), "utf-8");
  }
}

/**
 * Checks whether a file contains a specific string.
 * Useful for idempotency checks before modifying files.
 */
export async function fileContains(
  filePath: string,
  search: string,
): Promise<boolean> {
  const content = await readFile(filePath, "utf-8");
  return content.includes(search);
}
