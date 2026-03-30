import type { TemplateContext } from "../../utils/context.js";

/** Template for standalone aggregate definition (state in separate file). */
export function aggregateTemplate(ctx: TemplateContext): string {
  return `import { defineAggregate, DefineEvents, DefineCommands, Infrastructure } from "@noddde/core";
import type { ${ctx.name}State } from "./state.js";
import { initial${ctx.name}State } from "./state.js";
import type { Create${ctx.name}Payload } from "./commands/create-${ctx.kebabName}.js";
import { handleCreate${ctx.name} } from "./command-handlers/index.js";
import { apply${ctx.name}Created } from "./apply-handlers/index.js";

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
  infrastructure: Infrastructure; // TODO: replace with domain-specific infrastructure type
};

// ── Aggregate definition ────────────────────────────────────────

export const ${ctx.name} = defineAggregate<${ctx.name}Def>({
  initialState: initial${ctx.name}State,

  commands: {
    Create${ctx.name}: handleCreate${ctx.name},
  },

  apply: {
    ${ctx.name}Created: apply${ctx.name}Created,
  },
});
`;
}
