import type { TemplateContext } from "../../utils/context.js";

/** Template for .../commands/index.ts — barrel re-exporting command payloads. */
export function commandsIndexTemplate(ctx: TemplateContext): string {
  return `export type { Create${ctx.name}Payload } from "./create-${ctx.kebabName}.js";
`;
}

/** Template for .../commands/create-<name>.ts — individual command payload. */
export function commandPayloadTemplate(ctx: TemplateContext): string {
  return `/** Payload for the Create${ctx.name} command. */
export interface Create${ctx.name}Payload {
  // TODO: add command payload fields
}
`;
}
