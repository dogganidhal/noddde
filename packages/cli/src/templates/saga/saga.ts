import type { TemplateContext } from "../../utils/context.js";

/** Template for the saga definition file (state in separate file, handlers extracted). */
export function sagaTemplate(ctx: TemplateContext): string {
  return `import { defineSaga, DefineEvents } from "@noddde/core";
import type { ${ctx.name}SagaState } from "./state.js";
import { initial${ctx.name}SagaState } from "./state.js";
import { onStartEvent } from "./on-entries/index.js";

// TODO: import event and command types from related aggregates, and replace
// ${ctx.name}Started below with the real event that starts this saga.
// import type { SomeEvent } from "../some-aggregate/events.js";
// import type { SomeCommand } from "../some-aggregate/commands.js";

// ── Types bundle ────────────────────────────────────────────────

// TODO: replace with the event(s) that start and drive this saga instance
type ${ctx.name}SagaEvent = DefineEvents<{
  ${ctx.name}Started: { id: string };
}>;

type ${ctx.name}SagaDef = {
  state: ${ctx.name}SagaState;
  events: ${ctx.name}SagaEvent;
  commands: never; // TODO: replace with union of command types
  infrastructure: Record<string, never>; // TODO: add infrastructure dependencies
};

// ── Saga definition ─────────────────────────────────────────────

export const ${ctx.name}Saga = defineSaga<${ctx.name}SagaDef>({
  // atomicity defaults to "atomic" (state + reaction commands commit together).
  // Set "best-effort" to commit saga state before dispatching commands — needed
  // when a command handler publishes a consumed event directly via the event bus.
  // atomicity: "best-effort",

  initialState: initial${ctx.name}SagaState,

  startedBy: ["${ctx.name}Started"],

  on: {
    ${ctx.name}Started: {
      id: (event) => event.payload.id,
      handle: onStartEvent,
    },
  },
});
`;
}
