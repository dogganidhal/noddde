import path from "node:path";
import { buildContext } from "../utils/context.js";
import { validateName } from "../utils/naming.js";
import { writeFileIfNotExists } from "../utils/fs.js";
import {
  fileContains,
  insertBeforeMarker,
  insertAfterLastMatch,
  appendToBarrel,
  insertImports,
} from "../utils/file-modifier.js";
import {
  addQueryPayloadTemplate,
  addQueryHandlerTemplate,
} from "../templates/add/query.js";
import type { AddQueryContext } from "../templates/add/query.js";

/**
 * Adds a query (with handler) to an existing projection.
 *
 * Creates new files for the query payload and handler, then
 * wires them into the projection's barrel files and definition file.
 */
export async function addQueryToProjection(
  queryName: string,
  projectionDir: string,
): Promise<void> {
  validateName(queryName);

  const query = buildContext(queryName);
  const projectionKebab = path.basename(projectionDir);
  const projection = buildContext(projectionKebab);

  const ctx: AddQueryContext = { projection, query };

  // ── Check idempotency ──────────────────────────────────────────
  const projDefFile = path.join(projectionDir, `${projection.kebabName}.ts`);
  if (await fileContains(projDefFile, `${query.name}:`)) {
    console.log(
      `  Skipped — query "${query.name}" already exists in ${projection.name}Projection`,
    );
    return;
  }

  // ── 1. Create new files ────────────────────────────────────────
  const newFiles = [
    {
      relativePath: `queries/${query.kebabName}.ts`,
      content: addQueryPayloadTemplate(ctx),
    },
    {
      relativePath: `query-handlers/handle-${query.kebabName}.ts`,
      content: addQueryHandlerTemplate(ctx),
    },
  ];

  for (const file of newFiles) {
    const filePath = path.join(projectionDir, file.relativePath);
    const created = await writeFileIfNotExists(filePath, file.content);
    if (created) {
      console.log(`  Created ${path.relative(process.cwd(), filePath)}`);
    } else {
      console.log(
        `  Skipped ${path.relative(process.cwd(), filePath)} (already exists)`,
      );
    }
  }

  // ── 2. Update barrel files ─────────────────────────────────────
  const queriesIndex = path.join(projectionDir, "queries/index.ts");

  // Add import for the new query payload
  await insertImports(
    queriesIndex,
    `import type { ${query.name}Payload } from "./${query.kebabName}.js";`,
  );

  // Add entry to DefineQueries<{...}> — insert before closing }>
  // Find the last query entry and insert after it
  const queriesHasEntries = await fileContains(queriesIndex, "payload:");
  if (queriesHasEntries) {
    await insertAfterLastMatch(
      queriesIndex,
      /^\s+};$/,
      `  ${query.name}: {\n    payload: ${query.name}Payload;\n    result: ${projection.name}View | null;\n  };`,
    );
  } else {
    // If no entries yet (shouldn't happen), insert before closing of DefineQueries
    await insertBeforeMarker(
      queriesIndex,
      "}>",
      `  ${query.name}: {\n    payload: ${query.name}Payload;\n    result: ${projection.name}View | null;\n  };`,
    );
  }

  console.log(`  Updated ${path.relative(process.cwd(), queriesIndex)}`);

  const handlersIndex = path.join(projectionDir, "query-handlers/index.ts");
  await appendToBarrel(
    handlersIndex,
    `export { handle${query.name} } from "./handle-${query.kebabName}.js";`,
  );
  console.log(`  Updated ${path.relative(process.cwd(), handlersIndex)}`);

  // ── 3. Update projection definition file ───────────────────────
  // Add import for the handler
  await insertImports(
    projDefFile,
    `import { handle${query.name} } from "./query-handlers/index.js";`,
  );

  // Add to queryHandlers: { ... } — insert after last existing entry
  await insertAfterLastMatch(
    projDefFile,
    /^\s+\w+: handle\w+,$/,
    `    ${query.name}: handle${query.name},`,
  );

  console.log(`  Updated ${path.relative(process.cwd(), projDefFile)}`);
}
