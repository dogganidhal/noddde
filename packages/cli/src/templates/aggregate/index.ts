import type { TemplateContext } from "../../utils/context.js";

/** Template for the aggregate barrel (index.ts). */
export function aggregateIndexTemplate(ctx: TemplateContext): string {
  return `export { ${ctx.name} } from "./aggregate.js";
export type { ${ctx.name}State } from "./state.js";
export { initial${ctx.name}State } from "./state.js";
export type { ${ctx.name}Event } from "./events/index.js";
export type { ${ctx.name}Command } from "./commands/index.js";
export type { ${ctx.name}Infrastructure } from "./infrastructure.js";
`;
}
