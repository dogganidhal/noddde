import path from "node:path";
import { buildContext } from "../utils/context.js";
import { validateName, toKebabCase } from "../utils/naming.js";
import { writeFileIfNotExists } from "../utils/fs.js";
import {
  fileContains,
  insertAfterLastMatch,
  appendToBarrel,
  insertImports,
} from "../utils/file-modifier.js";
import { addEventHandlerTemplate } from "../templates/add/event-handler.js";
import type { AddEventHandlerContext } from "../templates/add/event-handler.js";

/**
 * Adds an event handler (on-entry / view reducer) to an existing projection.
 *
 * Creates a new on-entry file and wires it into the projection's barrel
 * and definition file.
 */
export async function addEventHandlerToProjection(
  eventName: string,
  projectionDir: string,
): Promise<void> {
  validateName(eventName);

  const projectionKebab = path.basename(projectionDir);
  const projection = buildContext(projectionKebab);
  const eventKebabName = toKebabCase(eventName);

  const ctx: AddEventHandlerContext = {
    projection,
    eventName,
    eventKebabName,
  };

  // ── Check idempotency ──────────────────────────────────────────
  const projDefFile = path.join(projectionDir, `${projection.kebabName}.ts`);
  if (await fileContains(projDefFile, `on${eventName}`)) {
    console.log(
      `  Skipped — event handler "on${eventName}" already exists in ${projection.name}Projection`,
    );
    return;
  }

  // ── 1. Create new file ─────────────────────────────────────────
  const filePath = path.join(
    projectionDir,
    `on-entries/on-${eventKebabName}.ts`,
  );
  const created = await writeFileIfNotExists(
    filePath,
    addEventHandlerTemplate(ctx),
  );
  if (created) {
    console.log(`  Created ${path.relative(process.cwd(), filePath)}`);
  } else {
    console.log(
      `  Skipped ${path.relative(process.cwd(), filePath)} (already exists)`,
    );
  }

  // ── 2. Update barrel ───────────────────────────────────────────
  const onEntriesIndex = path.join(projectionDir, "on-entries/index.ts");
  await appendToBarrel(
    onEntriesIndex,
    `export { on${eventName} } from "./on-${eventKebabName}.js";`,
  );
  console.log(`  Updated ${path.relative(process.cwd(), onEntriesIndex)}`);

  // ── 3. Update projection definition file ───────────────────────
  // Add import for the handler
  await insertImports(
    projDefFile,
    `import { on${eventName} } from "./on-entries/index.js";`,
  );

  // Add to on: { ... } map
  // Try inserting after the last existing on-entry
  const insertedAfterExisting = await insertAfterLastMatch(
    projDefFile,
    /^\s+reduce: on\w+,$/,
    `  },\n    ${eventName}: {\n      reduce: on${eventName},`,
  );

  if (!insertedAfterExisting) {
    // No existing on-entries — insert after "on: {"
    await insertAfterLastMatch(
      projDefFile,
      /^\s+on:\s*\{$/,
      `    ${eventName}: {\n      reduce: on${eventName},\n    },`,
    );
  }

  console.log(`  Updated ${path.relative(process.cwd(), projDefFile)}`);
}
