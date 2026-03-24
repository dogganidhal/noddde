import type { TemplateContext } from "../../utils/context.js";

/** Template for queries/index.ts — the DefineQueries union. */
export function queriesIndexTemplate(ctx: TemplateContext): string {
  return `import { DefineQueries } from "@noddde/core";
import type { ${ctx.name}View } from "../view.js";

export { get${ctx.name} } from "./get-${ctx.kebabName}.js";

export type ${ctx.name}Query = DefineQueries<{
  Get${ctx.name}: {
    payload: { id: string };
    result: ${ctx.name}View | null;
  };
}>;
`;
}
