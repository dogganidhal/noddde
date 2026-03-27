import type { TemplateContext } from "../../utils/context.js";

/** Template for the saga definition file (state in separate file, handlers extracted). */
export function sagaTemplate(ctx: TemplateContext): string {
  return `import { defineSaga } from "@noddde/core";
import type { ${ctx.name}SagaState } from "./state.js";
import { initial${ctx.name}SagaState } from "./state.js";
import { onStartEvent } from "./transition-handlers/index.js";

// TODO: import event and command types from related aggregates
// import type { SomeEvent } from "../some-aggregate/events.js";
// import type { SomeCommand } from "../some-aggregate/commands.js";

// ── Types bundle ────────────────────────────────────────────────

type ${ctx.name}SagaDef = {
  state: ${ctx.name}SagaState;
  events: never; // TODO: replace with union of event types from related aggregates
  commands: never; // TODO: replace with union of command types
  infrastructure: Record<string, never>; // TODO: add infrastructure dependencies
};

// ── Saga definition ─────────────────────────────────────────────

export const ${ctx.name}Saga = defineSaga<${ctx.name}SagaDef>({
  initialState: initial${ctx.name}SagaState,

  startedBy: [
    // TODO: event name that starts a new saga instance
    // "SomeEventName",
  ],

  on: {
    // TODO: wire transition handlers with identity extraction
    // SomeEventName: {
    //   id: (event) => event.payload.someId,
    //   handle: onStartEvent,
    // },
  },
});
`;
}
