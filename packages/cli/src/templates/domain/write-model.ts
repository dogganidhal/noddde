import type { TemplateContext } from "../../utils/context.js";

/** Template for domain/write-model/index.ts — barrel re-exporting aggregate. */
export function writeModelIndexTemplate(ctx: TemplateContext): string {
  return `export { ${ctx.name} } from "./aggregates/${ctx.kebabName}/index.js";
export type {
  ${ctx.name}State,
  ${ctx.name}Event,
  ${ctx.name}Command,
} from "./aggregates/${ctx.kebabName}/index.js";
`;
}
