import type { TemplateContext } from "../../utils/context.js";

/** Template for .../query-handlers/index.ts — barrel re-exporting handlers. */
export function queryHandlersIndexTemplate(ctx: TemplateContext): string {
  return `export { handleGet${ctx.name} } from "./handle-get-${ctx.kebabName}.js";
`;
}

/** Template for .../query-handlers/handle-get-<name>.ts — standalone query handler. */
export function queryHandlerTemplate(ctx: TemplateContext): string {
  return `import type { ${ctx.name}View } from "../queries/index.js";
import type { ViewStore } from "@noddde/core";

/** Handles the Get${ctx.name} query. */
export async function handleGet${ctx.name}(
  query: { payload: { id: string } },
  { views }: { views: ViewStore<${ctx.name}View> },
): Promise<${ctx.name}View | null> {
  return (await views.load(query.payload.id)) ?? null;
}
`;
}
