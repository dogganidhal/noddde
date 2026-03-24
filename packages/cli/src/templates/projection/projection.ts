import type { TemplateContext } from "../../utils/context.js";

/** Template for the projection definition file. */
export function projectionTemplate(ctx: TemplateContext): string {
  return `import type { ViewStore } from "@noddde/core";
import { defineProjection } from "@noddde/core";
import type { ${ctx.name}View } from "./view.js";
import type { ${ctx.name}Query } from "./queries/index.js";
import { get${ctx.name} } from "./queries/index.js";

// TODO: import event types from the aggregate(s) this projection tracks
// import type { ${ctx.name}Event } from "../${ctx.kebabName}/events/index.js";

type ${ctx.name}ProjectionDef = {
  events: never; // TODO: replace with event union type
  queries: ${ctx.name}Query;
  view: ${ctx.name}View;
  infrastructure: Record<string, never>;
  viewStore: ViewStore<${ctx.name}View>;
};

export const ${ctx.name}Projection = defineProjection<${ctx.name}ProjectionDef>({
  reducers: {
    // TODO: add reducers for each event
    // ${ctx.name}Created: (event) => ({
    //   id: event.payload.id,
    // }),
  },

  identity: {
    // TODO: map events to view IDs
    // ${ctx.name}Created: (event) => event.payload.id,
  },

  viewStore: (infra) => infra.views,

  queryHandlers: {
    Get${ctx.name}: async (query, { views }) => get${ctx.name}(query, views),
  },
});
`;
}
