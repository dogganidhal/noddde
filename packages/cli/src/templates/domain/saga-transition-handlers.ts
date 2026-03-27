import type { TemplateContext } from "../../utils/context.js";

/** Template for transition-handlers/index.ts — barrel re-exporting handlers. */
export function transitionHandlersIndexTemplate(): string {
  return `export { onStartEvent } from "./on-start-event.js";
`;
}

/** Template for transition-handlers/on-start-event.ts — standalone transition handler. */
export function transitionHandlerTemplate(ctx: TemplateContext): string {
  return `import type { ${ctx.name}SagaState } from "../state.js";

/** Handles the initial event that starts the ${ctx.name} saga. */
export function onStartEvent(
  event: { payload: { id: string } },
  state: ${ctx.name}SagaState,
) {
  return {
    state: {
      ...state,
      status: "started",
      // TODO: extract relevant data from the event
    },
    // TODO: dispatch commands to other aggregates
    // commands: {
    //   name: "SomeCommand" as const,
    //   targetAggregateId: event.payload.id,
    //   payload: { ... },
    // },
  };
}
`;
}
