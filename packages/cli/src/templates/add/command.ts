import type { TemplateContext } from "../../utils/context.js";

/** Context for adding a command to an existing aggregate. */
export interface AddCommandContext {
  /** The aggregate context (PascalCase name, kebab, camel). */
  aggregate: TemplateContext;
  /** The command context (PascalCase name, kebab, camel). */
  command: TemplateContext;
  /** The derived event name in PascalCase, e.g. "BidPlaced". */
  eventName: string;
  /** kebab-case event name, e.g. "bid-placed". */
  eventKebabName: string;
}

/** Template for a new command payload interface file. */
export function addCommandPayloadTemplate(ctx: AddCommandContext): string {
  return `/** Payload for the ${ctx.command.name} command. */
export interface ${ctx.command.name}Payload {
  // TODO: add command payload fields
}
`;
}

/** Template for a new decider handler file. */
export function addDeciderTemplate(ctx: AddCommandContext): string {
  return `import type { InferDecideHandler } from "@noddde/core";
import type { ${ctx.aggregate.name}Def } from "../${ctx.aggregate.kebabName}.js";

/** Decides the ${ctx.command.name} command. */
export const decide${ctx.command.name}: InferDecideHandler<${ctx.aggregate.name}Def, "${ctx.command.name}"> = (command, _state) => ({
  name: "${ctx.eventName}" as const,
  payload: {
    id: command.targetAggregateId,
    // TODO: map command payload to event payload
  },
});
`;
}

/** Template for a new evolver handler file. */
export function addEvolverTemplate(ctx: AddCommandContext): string {
  return `import type { InferEvolveHandler } from "@noddde/core";
import type { ${ctx.aggregate.name}Def } from "../${ctx.aggregate.kebabName}.js";

/** Evolves state for ${ctx.eventName}. */
export const evolve${ctx.eventName}: InferEvolveHandler<${ctx.aggregate.name}Def, "${ctx.eventName}"> = (_payload, state) => ({
  ...state,
  // TODO: evolve state from event payload
});
`;
}
