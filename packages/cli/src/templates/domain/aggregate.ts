import type { TemplateContext } from "../../utils/context.js";

/** Template for .../aggregates/<name>/index.ts — barrel with type unions. */
export function domainAggregateIndexTemplate(ctx: TemplateContext): string {
  return `export { ${ctx.name} } from "./${ctx.kebabName}.js";
export type { ${ctx.name}State } from "./state.js";
export { initial${ctx.name}State } from "./state.js";
export type { ${ctx.name}Event } from "./${ctx.kebabName}.js";
export type { ${ctx.name}Command } from "./${ctx.kebabName}.js";
`;
}

/** Template for .../aggregates/<name>/<name>.ts — aggregate definition (state in separate file). */
export function domainAggregateTemplate(ctx: TemplateContext): string {
  return `import { defineAggregate, DefineEvents, DefineCommands } from "@noddde/core";
import type { ${ctx.name}State } from "./state.js";
import { initial${ctx.name}State } from "./state.js";
import type { ${ctx.name}CreatedPayload } from "../../../event-model/${ctx.kebabName}-created.js";
import type { Create${ctx.name}Payload } from "./commands/create-${ctx.kebabName}.js";
import type { ${ctx.name}Infrastructure } from "../../../../infrastructure/index.js";
import { decideCreate${ctx.name} } from "./deciders/index.js";
import { evolve${ctx.name}Created } from "./evolvers/index.js";

// ── Type unions ─────────────────────────────────────────────────

export type ${ctx.name}Event = DefineEvents<{
  ${ctx.name}Created: ${ctx.name}CreatedPayload;
  // TODO: add more events
}>;

export type ${ctx.name}Command = DefineCommands<{
  Create${ctx.name}: Create${ctx.name}Payload;
  // TODO: add more commands
}>;

// ── Types bundle ────────────────────────────────────────────────

export type ${ctx.name}Def = {
  state: ${ctx.name}State;
  events: ${ctx.name}Event;
  commands: ${ctx.name}Command;
  infrastructure: ${ctx.name}Infrastructure;
};

// ── Aggregate definition ────────────────────────────────────────

export const ${ctx.name} = defineAggregate<${ctx.name}Def>({
  initialState: initial${ctx.name}State,

  decide: {
    Create${ctx.name}: decideCreate${ctx.name},
  },

  evolve: {
    ${ctx.name}Created: evolve${ctx.name}Created,
  },
});
`;
}
