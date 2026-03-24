import path from "node:path";
import { buildContext } from "../utils/context.js";
import { writeFileIfNotExists } from "../utils/fs.js";
import { projectionIndexTemplate } from "../templates/projection/index.js";
import { viewTemplate } from "../templates/projection/view.js";
import { queriesIndexTemplate } from "../templates/projection/queries-index.js";
import { queryHandlerTemplate } from "../templates/projection/query-handler.js";
import { projectionTemplate } from "../templates/projection/projection.js";

/** Generates a projection folder with all required files. */
export async function generateProjection(
  name: string,
  basePath: string,
): Promise<void> {
  const ctx = buildContext(name);
  const dir = path.resolve(basePath, ctx.kebabName);

  const files: Array<{ relativePath: string; content: string }> = [
    { relativePath: "index.ts", content: projectionIndexTemplate(ctx) },
    { relativePath: "view.ts", content: viewTemplate(ctx) },
    { relativePath: "projection.ts", content: projectionTemplate(ctx) },
    {
      relativePath: "queries/index.ts",
      content: queriesIndexTemplate(ctx),
    },
    {
      relativePath: `queries/get-${ctx.kebabName}.ts`,
      content: queryHandlerTemplate(ctx),
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
