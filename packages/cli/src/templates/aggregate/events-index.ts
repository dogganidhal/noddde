import type { TemplateContext } from "../../utils/context.js";

/** Template for events/index.ts — the DefineEvents union. */
export function eventsIndexTemplate(ctx: TemplateContext): string {
  return `import { DefineEvents } from "@noddde/core";
import type { ${ctx.name}CreatedPayload } from "./${ctx.kebabName}-created.js";

export type { ${ctx.name}CreatedPayload } from "./${ctx.kebabName}-created.js";

export type ${ctx.name}Event = DefineEvents<{
  ${ctx.name}Created: ${ctx.name}CreatedPayload;
}>;
`;
}
