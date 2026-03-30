import path from "node:path";
import { buildContext } from "../utils/context.js";
import { writeFileIfNotExists } from "../utils/fs.js";
import { validateName } from "../utils/naming.js";
import { aggregateIndexTemplate } from "../templates/aggregate/index.js";
import { aggregateTemplate } from "../templates/aggregate/aggregate.js";
import { aggregateStateTemplate } from "../templates/domain/aggregate-state.js";
import {
  commandsIndexTemplate,
  commandPayloadTemplate,
} from "../templates/domain/aggregate-commands.js";
import {
  commandHandlersIndexTemplate,
  commandHandlerTemplate,
} from "../templates/domain/aggregate-command-handlers.js";
import {
  applyHandlersIndexTemplate,
  applyHandlerTemplate,
} from "../templates/domain/aggregate-apply-handlers.js";

/** Generates an aggregate folder with commands, command-handlers, and apply-handlers subdirectories. */
export async function generateAggregate(
  name: string,
  basePath: string,
): Promise<void> {
  validateName(name);
  const ctx = buildContext(name);
  const dir = path.resolve(basePath, ctx.kebabName);

  const files: Array<{ relativePath: string; content: string }> = [
    { relativePath: "index.ts", content: aggregateIndexTemplate(ctx) },
    { relativePath: "state.ts", content: aggregateStateTemplate(ctx) },
    { relativePath: `${ctx.kebabName}.ts`, content: aggregateTemplate(ctx) },
    {
      relativePath: "commands/index.ts",
      content: commandsIndexTemplate(ctx),
    },
    {
      relativePath: `commands/create-${ctx.kebabName}.ts`,
      content: commandPayloadTemplate(ctx),
    },
    {
      relativePath: "command-handlers/index.ts",
      content: commandHandlersIndexTemplate(ctx),
    },
    {
      relativePath: `command-handlers/handle-create-${ctx.kebabName}.ts`,
      content: commandHandlerTemplate(ctx),
    },
    {
      relativePath: "apply-handlers/index.ts",
      content: applyHandlersIndexTemplate(ctx),
    },
    {
      relativePath: `apply-handlers/apply-${ctx.kebabName}-created.ts`,
      content: applyHandlerTemplate(ctx),
    },
  ];

  for (const file of files) {
    const filePath = path.join(dir, file.relativePath);
    const created = await writeFileIfNotExists(filePath, file.content);
    if (created) {
      console.log(`  Created ${path.relative(process.cwd(), filePath)}`);
    } else {
      console.log(
        `  Skipped ${path.relative(process.cwd(), filePath)} (already exists)`,
      );
    }
  }
}
