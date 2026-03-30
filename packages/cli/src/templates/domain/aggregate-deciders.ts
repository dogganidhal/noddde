import type { TemplateContext } from "../../utils/context.js";

/** Template for .../deciders/index.ts — barrel re-exporting deciders. */
export function decidersIndexTemplate(ctx: TemplateContext): string {
  return `export { decideCreate${ctx.name} } from "./decide-create-${ctx.kebabName}.js";
`;
}

/** Template for .../deciders/decide-create-<name>.ts — standalone decide handler. */
export function deciderTemplate(ctx: TemplateContext): string {
  return `import type { InferDecideHandler } from "@noddde/core";
import type { ${ctx.name}Def } from "../${ctx.kebabName}.js";

/** Decides the Create${ctx.name} command. */
export const decideCreate${ctx.name}: InferDecideHandler<${ctx.name}Def, "Create${ctx.name}"> = (command, _state) => ({
  name: "${ctx.name}Created" as const,
  payload: {
    id: command.targetAggregateId,
  },
});
`;
}
