import type { TemplateContext } from "../../utils/context.js";

/** Template for an individual saga event handler file. */
export function sagaHandlerTemplate(ctx: TemplateContext): string {
  return `import type { ${ctx.name}SagaState } from "../state.js";

// TODO: import the event type this handler reacts to
// import type { SomeEvent } from "../../some-aggregate/events/index.js";

/** Handles the initial event that starts the ${ctx.name} saga. */
export function onStartEvent(
  _event: unknown,
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
    //   name: "SomeCommand",
    //   targetAggregateId: "...",
    //   payload: { ... },
    // },
  };
}
`;
}
