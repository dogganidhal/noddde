import type { TemplateContext } from "../../utils/context.js";

/** Template for standalone aggregate definition (state in separate file). */
export function aggregateTemplate(ctx: TemplateContext): string {
  return `import { defineAggregate, DefineEvents, DefineCommands, Ports } from "@noddde/core";
import type { ${ctx.name}State } from "./state.js";
import { initial${ctx.name}State } from "./state.js";
import type { Create${ctx.name}Payload } from "./commands/create-${ctx.kebabName}.js";
import { decideCreate${ctx.name} } from "./deciders/index.js";
import { evolve${ctx.name}Created } from "./evolvers/index.js";

// ── Type unions ─────────────────────────────────────────────────

export type ${ctx.name}Event = DefineEvents<{
  ${ctx.name}Created: { id: string };
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
  ports: Ports; // TODO: replace with domain-specific ports type
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
