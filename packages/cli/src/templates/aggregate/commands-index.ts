import type { TemplateContext } from "../../utils/context.js";

/** Template for commands/index.ts — the DefineCommands union. */
export function commandsIndexTemplate(ctx: TemplateContext): string {
  return `import { DefineCommands } from "@noddde/core";
import type { Create${ctx.name}Payload } from "./create-${ctx.kebabName}.js";

export type { Create${ctx.name}Payload } from "./create-${ctx.kebabName}.js";

export type ${ctx.name}Command = DefineCommands<{
  Create${ctx.name}: Create${ctx.name}Payload;
}>;
`;
}
