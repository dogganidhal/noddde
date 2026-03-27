import type { TemplateContext } from "../../utils/context.js";

/** Template for domain/event-model/index.ts — barrel re-exporting all event payloads. */
export function eventModelIndexTemplate(ctx: TemplateContext): string {
  return `export type { ${ctx.name}CreatedPayload } from "./${ctx.kebabName}-created.js";
`;
}

/** Template for domain/event-model/<name>-created.ts — individual event payload. */
export function eventPayloadTemplate(ctx: TemplateContext): string {
  return `/** Payload for the ${ctx.name}Created event. */
export interface ${ctx.name}CreatedPayload {
  id: string;
  // TODO: add event payload fields
}
`;
}
