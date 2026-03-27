import type { TemplateContext } from "../../utils/context.js";

/** Template for the saga definition file (includes state inline). */
export function sagaTemplate(ctx: TemplateContext): string {
  return `import { defineSaga } from "@noddde/core";

// TODO: import event and command types from related aggregates
// import type { SomeEvent } from "../some-aggregate/events.js";
// import type { SomeCommand } from "../some-aggregate/commands.js";

// ── Saga state ──────────────────────────────────────────────────

export interface ${ctx.name}SagaState {
  status: string | null;
  // TODO: add saga state fields for tracking workflow progress
}

const initial${ctx.name}SagaState: ${ctx.name}SagaState = {
  status: null,
};

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
    // TODO: wire event handlers with identity extraction
    // SomeEventName: {
    //   id: (event) => event.payload.someId,
    //   handle: async (event, _state, _infrastructure) => ({
    //     state: { status: "started" },
    //     commands: {
    //       name: "SomeCommand",
    //       targetAggregateId: event.payload.someId,
    //       payload: { ... },
    //     },
    //   }),
    // },
  },
});
`;
}
