import type { TemplateContext } from "../../utils/context.js";

/** Template for an individual event payload file. */
export function eventTemplate(ctx: TemplateContext): string {
  return `/** Payload for the ${ctx.name}Created event. */
export interface ${ctx.name}CreatedPayload {
  // TODO: add event payload fields
  id: string;
}
`;
}
