import type { TemplateContext } from "../../utils/context.js";

/** Template for .../apply-handlers/index.ts — barrel re-exporting apply handlers. */
export function applyHandlersIndexTemplate(ctx: TemplateContext): string {
  return `export { apply${ctx.name}Created } from "./apply-${ctx.kebabName}-created.js";
`;
}

/** Template for .../apply-handlers/apply-<name>-created.ts — standalone apply handler. */
export function applyHandlerTemplate(ctx: TemplateContext): string {
  return `import type { InferApplyHandler } from "@noddde/core";
import type { ${ctx.name}Def } from "../${ctx.kebabName}.js";

/** Applies ${ctx.name}Created to state. */
export const apply${ctx.name}Created: InferApplyHandler<${ctx.name}Def, "${ctx.name}Created"> = (payload, state) => ({
  ...state,
  id: payload.id,
  // TODO: apply event payload to state
});
`;
}
