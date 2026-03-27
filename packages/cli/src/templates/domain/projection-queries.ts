import type { TemplateContext } from "../../utils/context.js";

/** Template for .../queries/index.ts — DefineQueries + View interface. */
export function queriesIndexTemplate(ctx: TemplateContext): string {
  return `import { DefineQueries } from "@noddde/core";
import type { Get${ctx.name}Payload } from "./get-${ctx.kebabName}.js";

/** Read model for ${ctx.name}. */
export interface ${ctx.name}View {
  id: string;
  // TODO: define read model fields
}

export type ${ctx.name}Query = DefineQueries<{
  Get${ctx.name}: {
    payload: Get${ctx.name}Payload;
    result: ${ctx.name}View | null;
  };
}>;
`;
}

/** Template for .../queries/get-<name>.ts — query payload type. */
export function queryPayloadTemplate(ctx: TemplateContext): string {
  return `/** Payload for the Get${ctx.name} query. */
export interface Get${ctx.name}Payload {
  id: string;
}
`;
}
