import type { TemplateContext } from "../../utils/context.js";

/** Template for .../projections/<name>/index.ts — barrel. */
export function domainProjectionIndexTemplate(ctx: TemplateContext): string {
  return `export { ${ctx.name}Projection } from "./${ctx.kebabName}.js";
export type { ${ctx.name}View, ${ctx.name}Query } from "./queries/index.js";
`;
}

/** Template for .../projections/<name>/<name>.ts — projection definition. */
export function domainProjectionTemplate(ctx: TemplateContext): string {
  return `import { defineProjection } from "@noddde/core";
import type { ViewStore } from "@noddde/core";
import type { ${ctx.name}View, ${ctx.name}Query } from "./queries/index.js";
import { handleGet${ctx.name} } from "./query-handlers/index.js";

// TODO: import event types and on-entries once wired
// import type { ${ctx.name}Event } from "../../write-model/aggregates/${ctx.kebabName}/index.js";
// import { on${ctx.name}Created } from "./on-entries/index.js";

export type ${ctx.name}ProjectionDef = {
  events: never; // TODO: replace with event union type
  queries: ${ctx.name}Query;
  view: ${ctx.name}View;
  viewStore: ViewStore<${ctx.name}View>;
  infrastructure: Record<string, never>;
};

export const ${ctx.name}Projection = defineProjection<${ctx.name}ProjectionDef>({
  on: {
    // TODO: uncomment and adjust when event types are wired
    // ${ctx.name}Created: {
    //   id: (event) => event.payload.id,
    //   reduce: on${ctx.name}Created,
    // },
  },

  queryHandlers: {
    Get${ctx.name}: handleGet${ctx.name},
  },
});
`;
}
