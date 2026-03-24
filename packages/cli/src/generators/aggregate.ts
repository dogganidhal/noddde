import path from "node:path";
import { buildContext } from "../utils/context.js";
import { writeFileIfNotExists } from "../utils/fs.js";
import { aggregateIndexTemplate } from "../templates/aggregate/index.js";
import { eventsIndexTemplate } from "../templates/aggregate/events-index.js";
import { eventTemplate } from "../templates/aggregate/event.js";
import { commandsIndexTemplate } from "../templates/aggregate/commands-index.js";
import { commandTemplate } from "../templates/aggregate/command.js";
import { stateTemplate } from "../templates/aggregate/state.js";
import { aggregateTemplate } from "../templates/aggregate/aggregate.js";
import { infrastructureTemplate } from "../templates/aggregate/infrastructure.js";

/** Generates an aggregate folder with all required files. */
export async function generateAggregate(
  name: string,
  basePath: string,
): Promise<void> {
  const ctx = buildContext(name);
  const dir = path.resolve(basePath, ctx.kebabName);

  const files: Array<{ relativePath: string; content: string }> = [
    { relativePath: "index.ts", content: aggregateIndexTemplate(ctx) },
    { relativePath: "state.ts", content: stateTemplate(ctx) },
    { relativePath: "aggregate.ts", content: aggregateTemplate(ctx) },
    {
      relativePath: "infrastructure.ts",
      content: infrastructureTemplate(ctx),
    },
    { relativePath: "events/index.ts", content: eventsIndexTemplate(ctx) },
    {
      relativePath: `events/${ctx.kebabName}-created.ts`,
      content: eventTemplate(ctx),
    },
    {
      relativePath: "commands/index.ts",
      content: commandsIndexTemplate(ctx),
    },
    {
      relativePath: `commands/create-${ctx.kebabName}.ts`,
      content: commandTemplate(ctx),
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
