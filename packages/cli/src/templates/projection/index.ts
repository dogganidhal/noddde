import type { TemplateContext } from "../../utils/context.js";

/** Template for the projection barrel (index.ts). */
export function projectionIndexTemplate(ctx: TemplateContext): string {
  return `export { ${ctx.name}Projection } from "./projection.js";
export type { ${ctx.name}View } from "./view.js";
export type { ${ctx.name}Query } from "./queries/index.js";
export { get${ctx.name} } from "./queries/index.js";
`;
}
