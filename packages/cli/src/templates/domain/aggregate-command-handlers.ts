import type { TemplateContext } from "../../utils/context.js";

/** Template for .../command-handlers/index.ts — barrel re-exporting handlers. */
export function commandHandlersIndexTemplate(ctx: TemplateContext): string {
  return `export { handleCreate${ctx.name} } from "./handle-create-${ctx.kebabName}.js";
`;
}

/** Template for .../command-handlers/handle-create-<name>.ts — standalone command handler. */
export function commandHandlerTemplate(ctx: TemplateContext): string {
  return `import type { InferCommandHandler } from "@noddde/core";
import type { ${ctx.name}Def } from "../${ctx.kebabName}.js";

/** Handles the Create${ctx.name} command. */
export const handleCreate${ctx.name}: InferCommandHandler<${ctx.name}Def, "Create${ctx.name}"> = (command, _state) => ({
  name: "${ctx.name}Created" as const,
  payload: {
    id: command.targetAggregateId,
  },
});
`;
}
