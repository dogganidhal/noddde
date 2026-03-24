import type { TemplateContext } from "../../utils/context.js";

/** Template for the aggregate definition file. */
export function aggregateTemplate(ctx: TemplateContext): string {
  return `import { defineAggregate } from "@noddde/core";
import type { ${ctx.name}State } from "./state.js";
import { initial${ctx.name}State } from "./state.js";
import type { ${ctx.name}Event } from "./events/index.js";
import type { ${ctx.name}Command } from "./commands/index.js";
import type { ${ctx.name}Infrastructure } from "./infrastructure.js";

type ${ctx.name}Def = {
  state: ${ctx.name}State;
  events: ${ctx.name}Event;
  commands: ${ctx.name}Command;
  infrastructure: ${ctx.name}Infrastructure;
};

export const ${ctx.name} = defineAggregate<${ctx.name}Def>({
  initialState: initial${ctx.name}State,

  commands: {
    Create${ctx.name}: (command) => ({
      name: "${ctx.name}Created",
      payload: {
        id: command.targetAggregateId,
        ...command.payload,
      },
    }),
  },

  apply: {
    ${ctx.name}Created: (payload) => ({
      ...initial${ctx.name}State,
      // TODO: apply event payload to state
    }),
  },
});
`;
}
