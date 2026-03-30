import type { TemplateContext } from "../../utils/context.js";

/** Template for on-entries/index.ts — barrel re-exporting saga on-entries. */
export function transitionHandlersIndexTemplate(): string {
  return `export { onStartEvent } from "./on-start-event.js";
`;
}

/** Template for on-entries/on-start-event.ts — standalone saga on-entry. */
export function transitionHandlerTemplate(ctx: TemplateContext): string {
  return `import type { ${ctx.name}SagaState } from "../state.js";

// TODO: once event types are wired in the saga def, replace with:
// import type { InferSagaOnEntry } from "@noddde/core";
// import type { ${ctx.name}SagaDef } from "../saga.js";
// export const onStartEvent: InferSagaOnEntry<${ctx.name}SagaDef, "StartEvent"> = { ... };

/** Handles the initial event that starts the ${ctx.name} saga. */
export function onStartEvent(
  event: { name: string; payload: { id: string } },
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
