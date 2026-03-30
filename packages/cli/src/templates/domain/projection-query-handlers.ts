import type { TemplateContext } from "../../utils/context.js";

/** Template for .../query-handlers/index.ts — barrel re-exporting handlers. */
export function queryHandlersIndexTemplate(ctx: TemplateContext): string {
  return `export { handleGet${ctx.name} } from "./handle-get-${ctx.kebabName}.js";
`;
}

/** Template for .../query-handlers/handle-get-<name>.ts — standalone query handler. */
export function queryHandlerTemplate(ctx: TemplateContext): string {
  return `import type { InferProjectionQueryHandler } from "@noddde/core";
import type { ${ctx.name}ProjectionDef } from "../${ctx.kebabName}.js";

/** Handles the Get${ctx.name} query. */
export const handleGet${ctx.name}: InferProjectionQueryHandler<${ctx.name}ProjectionDef, "Get${ctx.name}"> = async (query, { views }) =>
  (await views.load(query.payload.id)) ?? null;
`;
}
