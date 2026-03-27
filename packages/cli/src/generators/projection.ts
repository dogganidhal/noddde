import path from "node:path";
import { buildContext } from "../utils/context.js";
import { writeFileIfNotExists } from "../utils/fs.js";
import { validateName } from "../utils/naming.js";
import {
  domainProjectionIndexTemplate,
  domainProjectionTemplate,
} from "../templates/domain/projection.js";
import {
  queriesIndexTemplate,
  queryPayloadTemplate,
} from "../templates/domain/projection-queries.js";
import {
  queryHandlersIndexTemplate,
  queryHandlerTemplate,
} from "../templates/domain/projection-query-handlers.js";
import {
  viewReducersIndexTemplate,
  viewReducerTemplate,
} from "../templates/domain/projection-view-reducers.js";

/** Generates a projection folder with queries, query-handlers, and view-reducers subdirectories. */
export async function generateProjection(
  name: string,
  basePath: string,
): Promise<void> {
  validateName(name);
  const ctx = buildContext(name);
  const dir = path.resolve(basePath, ctx.kebabName);

  const files: Array<{ relativePath: string; content: string }> = [
    { relativePath: "index.ts", content: domainProjectionIndexTemplate(ctx) },
    {
      relativePath: `${ctx.kebabName}.ts`,
      content: domainProjectionTemplate(ctx),
    },
    {
      relativePath: "queries/index.ts",
      content: queriesIndexTemplate(ctx),
    },
    {
      relativePath: `queries/get-${ctx.kebabName}.ts`,
      content: queryPayloadTemplate(ctx),
    },
    {
      relativePath: "query-handlers/index.ts",
      content: queryHandlersIndexTemplate(ctx),
    },
    {
      relativePath: `query-handlers/handle-get-${ctx.kebabName}.ts`,
      content: queryHandlerTemplate(ctx),
    },
    {
      relativePath: "view-reducers/index.ts",
      content: viewReducersIndexTemplate(ctx),
    },
    {
      relativePath: `view-reducers/on-${ctx.kebabName}-created.ts`,
      content: viewReducerTemplate(ctx),
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
