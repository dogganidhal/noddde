import path from "node:path";
import { buildContext } from "../utils/context.js";
import { writeFileIfNotExists } from "../utils/fs.js";
import { validateName } from "../utils/naming.js";
import { sagaIndexTemplate } from "../templates/saga/index.js";
import { sagaTemplate } from "../templates/saga/saga.js";

/** Generates a saga folder with all required files. */
export async function generateSaga(
  name: string,
  basePath: string,
): Promise<void> {
  validateName(name);
  const ctx = buildContext(name);
  const dir = path.resolve(basePath, ctx.kebabName);

  const files: Array<{ relativePath: string; content: string }> = [
    { relativePath: "index.ts", content: sagaIndexTemplate(ctx) },
    { relativePath: "saga.ts", content: sagaTemplate(ctx) },
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
