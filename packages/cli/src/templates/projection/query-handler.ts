import type { TemplateContext } from "../../utils/context.js";

/** Template for an individual query handler file. */
export function queryHandlerTemplate(ctx: TemplateContext): string {
  return `import type { ${ctx.name}View } from "../view.js";
import type { ViewStore } from "@noddde/core";

/** Handles the Get${ctx.name} query. */
export async function get${ctx.name}(
  query: { id: string },
  views: ViewStore<${ctx.name}View>,
): Promise<${ctx.name}View | null> {
  return (await views.load(query.id)) ?? null;
}
`;
}
