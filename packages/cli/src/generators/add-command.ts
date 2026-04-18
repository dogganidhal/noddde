import path from "node:path";
import { buildContext } from "../utils/context.js";
import { validateName } from "../utils/naming.js";
import { toKebabCase } from "../utils/naming.js";
import { writeFileIfNotExists } from "../utils/fs.js";
import {
  fileContains,
  insertBeforeMarker,
  insertAfterLastMatch,
  appendToBarrel,
  insertImports,
} from "../utils/file-modifier.js";
import {
  addCommandPayloadTemplate,
  addDeciderTemplate,
  addEvolverTemplate,
} from "../templates/add/command.js";
import type { AddCommandContext } from "../templates/add/command.js";

/**
 * Adds a command (with decider and evolver) to an existing aggregate.
 *
 * Creates new files for the command payload, decider, and evolver, then
 * wires them into the aggregate's barrel files and definition file.
 */
export async function addCommandToAggregate(
  commandName: string,
  aggregateDir: string,
  options: { eventName: string },
): Promise<void> {
  validateName(commandName);
  validateName(options.eventName);

  const command = buildContext(commandName);
  const aggregateKebab = path.basename(aggregateDir);
  const aggregate = buildContext(aggregateKebab);
  const eventName = options.eventName;
  const eventKebabName = toKebabCase(eventName);

  const ctx: AddCommandContext = {
    aggregate,
    command,
    eventName,
    eventKebabName,
  };

  // ── Check idempotency ──────────────────────────────────────────
  const aggDefFile = path.join(aggregateDir, `${aggregate.kebabName}.ts`);
  if (await fileContains(aggDefFile, `${command.name}:`)) {
    console.log(
      `  Skipped — command "${command.name}" already exists in ${aggregate.name}`,
    );
    return;
  }

  // ── 1. Create new files ────────────────────────────────────────
  const newFiles = [
    {
      relativePath: `commands/${command.kebabName}.ts`,
      content: addCommandPayloadTemplate(ctx),
    },
    {
      relativePath: `deciders/decide-${command.kebabName}.ts`,
      content: addDeciderTemplate(ctx),
    },
    {
      relativePath: `evolvers/evolve-${eventKebabName}.ts`,
      content: addEvolverTemplate(ctx),
    },
  ];

  for (const file of newFiles) {
    const filePath = path.join(aggregateDir, file.relativePath);
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
  const commandsIndex = path.join(aggregateDir, "commands/index.ts");
  await appendToBarrel(
    commandsIndex,
    `export type { ${command.name}Payload } from "./${command.kebabName}.js";`,
  );
  console.log(`  Updated ${path.relative(process.cwd(), commandsIndex)}`);

  const decidersIndex = path.join(aggregateDir, "deciders/index.ts");
  await appendToBarrel(
    decidersIndex,
    `export { decide${command.name} } from "./decide-${command.kebabName}.js";`,
  );
  console.log(`  Updated ${path.relative(process.cwd(), decidersIndex)}`);

  const evolversIndex = path.join(aggregateDir, "evolvers/index.ts");
  await appendToBarrel(
    evolversIndex,
    `export { evolve${eventName} } from "./evolve-${eventKebabName}.js";`,
  );
  console.log(`  Updated ${path.relative(process.cwd(), evolversIndex)}`);

  // ── 3. Update aggregate definition file ────────────────────────
  // Add imports
  await insertImports(
    aggDefFile,
    `import type { ${command.name}Payload } from "./commands/${command.kebabName}.js";\nimport { decide${command.name} } from "./deciders/index.js";\nimport { evolve${eventName} } from "./evolvers/index.js";`,
  );

  // Add to DefineCommands<{...}> before "// TODO: add more commands"
  await insertBeforeMarker(
    aggDefFile,
    "// TODO: add more commands",
    `  ${command.name}: ${command.name}Payload;`,
  );

  // Add to DefineEvents<{...}> before "// TODO: add more events"
  await insertBeforeMarker(
    aggDefFile,
    "// TODO: add more events",
    `  ${eventName}: { id: string };`,
  );

  // Add to decide: { ... } — insert after last existing entry
  await insertAfterLastMatch(
    aggDefFile,
    /^\s+\w+: decide\w+,$/,
    `    ${command.name}: decide${command.name},`,
  );

  // Add to evolve: { ... } — insert after last existing entry
  await insertAfterLastMatch(
    aggDefFile,
    /^\s+\w+: evolve\w+,$/,
    `    ${eventName}: evolve${eventName},`,
  );

  console.log(`  Updated ${path.relative(process.cwd(), aggDefFile)}`);
}
