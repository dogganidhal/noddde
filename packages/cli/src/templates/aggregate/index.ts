import type { TemplateContext } from "../../utils/context.js";

/** Template for the standalone aggregate barrel (index.ts). */
export function aggregateIndexTemplate(ctx: TemplateContext): string {
  return `export { ${ctx.name} } from "./${ctx.kebabName}.js";
export type { ${ctx.name}State } from "./state.js";
export { initial${ctx.name}State } from "./state.js";
export type { ${ctx.name}Event } from "./${ctx.kebabName}.js";
export type { ${ctx.name}Command } from "./${ctx.kebabName}.js";
`;
}
