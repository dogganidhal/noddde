import type { TemplateContext } from "../../utils/context.js";

/** Template for .../evolvers/index.ts — barrel re-exporting evolvers. */
export function evolversIndexTemplate(ctx: TemplateContext): string {
  return `export { evolve${ctx.name}Created } from "./evolve-${ctx.kebabName}-created.js";
`;
}

/** Template for .../evolvers/evolve-<name>-created.ts — standalone evolve handler. */
export function evolverTemplate(ctx: TemplateContext): string {
  return `import type { InferEvolveHandler } from "@noddde/core";
import type { ${ctx.name}Def } from "../${ctx.kebabName}.js";

/** Evolves state for ${ctx.name}Created. */
export const evolve${ctx.name}Created: InferEvolveHandler<${ctx.name}Def, "${ctx.name}Created"> = (payload, state) => ({
  ...state,
  id: payload.id,
  // TODO: evolve state from event payload
});
`;
}
