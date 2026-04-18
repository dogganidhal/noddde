import type { TemplateContext } from "../../utils/context.js";

/** Context for adding a query to an existing projection. */
export interface AddQueryContext {
  /** The projection context (PascalCase name, kebab, camel). */
  projection: TemplateContext;
  /** The query context (PascalCase name, kebab, camel). */
  query: TemplateContext;
}

/** Template for a new query payload interface file. */
export function addQueryPayloadTemplate(ctx: AddQueryContext): string {
  return `/** Payload for the ${ctx.query.name} query. */
export interface ${ctx.query.name}Payload {
  id: string;
}
`;
}

/** Template for a new query handler file. */
export function addQueryHandlerTemplate(ctx: AddQueryContext): string {
  return `import type { InferProjectionQueryHandler } from "@noddde/core";
import type { ${ctx.projection.name}ProjectionDef } from "../${ctx.projection.kebabName}.js";

/** Handles the ${ctx.query.name} query. */
export const handle${ctx.query.name}: InferProjectionQueryHandler<${ctx.projection.name}ProjectionDef, "${ctx.query.name}"> = async (query, { views }) =>
  (await views.load(query.payload.id)) ?? null;
`;
}
