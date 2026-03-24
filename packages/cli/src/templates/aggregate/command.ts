import type { TemplateContext } from "../../utils/context.js";

/** Template for an individual command payload file. */
export function commandTemplate(ctx: TemplateContext): string {
  return `/** Payload for the Create${ctx.name} command. */
export interface Create${ctx.name}Payload {
  // TODO: add command payload fields
}
`;
}
