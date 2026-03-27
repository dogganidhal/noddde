---
title: "[SagaName] Saga"
module: ddd/[saga-name]
source_file: packages/[package]/src/[path]/[saga-name].ts
status: draft
exports: [[SagaName], [SagaName]Types]
depends_on:
  - core/ddd/saga
  - core/edd/event
  - core/cqrs/command
docs: []  # Documentation pages covering this module (paths relative to packages/docs/content/docs/)
---

# [SagaName] Saga

> [1-2 sentence summary of what cross-aggregate workflow this saga orchestrates, what events trigger it, and what commands it dispatches.]

## Type Contract

### State

<!--
  Define the saga's internal state. This tracks workflow progress,
  not domain truth. Saga state is state-stored (not event-sourced).
-->

```ts
type [SagaName]State = {
  // TODO: Define your saga state fields
  // Example:
  // status: "pending" | "processing" | "completed" | "failed";
  // orderId: string | null;
  // retryCount: number;
};
```

### Events (Inbound)

<!--
  Define all events this saga reacts to. These come from various aggregates.
  A saga is the structural inverse of an aggregate: event in -> commands out.
-->

```ts
import type { DefineEvents } from "@noddde/core";

// Typically a union of events from multiple aggregates:
// type [SagaName]Event = OrderEvent | PaymentEvent | ShippingEvent;

type [SagaName]Event = DefineEvents<{
  // TODO: List all events this saga handles
  // Example:
  // OrderPlaced: { orderId: string; amount: number };
  // PaymentCompleted: { orderId: string; paymentId: string };
  // PaymentFailed: { orderId: string; reason: string };
  // ShipmentDispatched: { orderId: string; trackingId: string };
}>;
```

### Commands (Outbound)

<!--
  Define all commands this saga may dispatch in reaction to events.
  These target various aggregates in the system.
-->

```ts
import type { DefineCommands } from "@noddde/core";

// Typically a union of commands targeting multiple aggregates:
type [SagaName]Command = DefineCommands<{
  // TODO: List all commands this saga may dispatch
  // Example:
  // RequestPayment: { orderId: string; amount: number };
  // CancelOrder: { reason: string };
  // DispatchShipment: { orderId: string; address: string };
}>;
```

### Infrastructure

<!--
  Define external dependencies available to saga event handlers.
  The framework automatically merges CQRSInfrastructure (commandBus, eventBus, queryBus).
-->

```ts
import type { Infrastructure } from "@noddde/core";

interface [SagaName]Infrastructure extends Infrastructure {
  // TODO: Define external dependencies, or use {} for none
  // Example:
  // notificationService: { send(to: string, message: string): Promise<void> };
  // clock: { now(): Date };
}
```

### SagaTypes Bundle

```ts
type [SagaName]Types = {
  state: [SagaName]State;
  events: [SagaName]Event;
  commands: [SagaName]Command;
  infrastructure: [SagaName]Infrastructure;
};
```

## Behavioral Requirements

### Lifecycle

<!--
  Describe the high-level workflow this saga orchestrates.
  Include a state diagram or step sequence.
-->

1. **Trigger**: [What event starts the saga and what initial actions are taken.]
2. **Step N**: [What event advances the saga and what commands are dispatched.]
3. **Completion**: [What event marks the saga as complete.]
4. **Failure/Compensation**: [What happens on failure -- compensating commands, etc.]

### Event Handlers

<!--
  For each event, describe:
  1. What state transition occurs.
  2. What command(s) are dispatched (if any).
  3. Under what conditions the handler does nothing.
-->

- **[EventName]**: [State transition. Commands dispatched. Conditions.]

### startedBy

<!--
  List which events can create a new saga instance.
  When one of these events arrives and no saga instance exists for the
  derived ID, a new instance is created with initialState.
-->

- Started by: `[EventName1]`, `[EventName2]`

### On Map (Associations + Handlers)

<!--
  For each event, describe how the saga instance ID is extracted (id)
  and what the handler (handle) does. Every event the saga reacts to
  must have an entry in the `on` map with both `id` and `handle`.
-->

- **[EventName]**: `id` = `event.payload.[field]`, `handle` = [description]

## Invariants

<!--
  List properties that must always hold for the saga state machine.
-->

- [ ] [Invariant 1: e.g., "A completed saga must not dispatch further commands."]
- [ ] [Invariant 2: e.g., "The retryCount never exceeds maxRetries."]
- [ ] [Invariant 3: e.g., "State transitions follow the defined state machine."]

## Edge Cases

- **Duplicate `startedBy` event**: If the saga instance already exists, the existing state is used (no re-initialization).
- **Non-starter event with no instance**: Silently ignored -- no handler invocation, no error.
- **Handler returns no commands**: Only state is persisted; no CommandBus interaction.
- **[Edge case]**: [How it is handled.]

## Integration Points

- Events come from: [aggregate names].
- Commands are dispatched to: [aggregate names].
- This saga may interact with: [other sagas, projections via queries].

## Saga Definition

```ts
import { defineSaga } from "@noddde/core";

const [SagaName] = defineSaga<[SagaName]Types>({
  initialState: {
    // TODO: Set your zero-value saga state
  },
  startedBy: [
    // TODO: List event names that can start this saga
    // "[EventName1]",
  ],
  on: {
    // TODO: Map each event to { id, handle } entries
    // [EventName]: {
    //   id: (event) => event.payload.[field],
    //   handle: (event, state, infrastructure) => ({
    //     state: { ...state, /* updated fields */ },
    //     commands: {
    //       name: "[CommandName]",
    //       targetAggregateId: "...",
    //       payload: { ... },
    //     },
    //   }),
    // },
  },
});
```

## Test Scenarios

### startedBy event creates instance and dispatches initial command

```ts
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";

describe("[SagaName]", () => {
  // TODO: Import or inline your saga definition

  it("should create a new instance on [startedBy EventName]", () => {
    const saga = /* your saga definition */;
    const event = {
      name: "[EventName]",
      payload: { /* TODO */ },
    };

    const onEntry = saga.on.[EventName];
    const sagaId = onEntry.id(event);
    const reaction = onEntry.handle(
      event,
      saga.initialState,
      { /* infrastructure + CQRS buses */ } as any,
    );

    expect(sagaId).toBe(/* expected saga ID */);
    expect(reaction.state).toEqual(/* expected new state */);
    expect(reaction.commands).toEqual(/* expected command(s) */);
  });
});
```

### Subsequent event transitions state and dispatches command

```ts
import { describe, it, expect } from "vitest";

describe("[SagaName] state transitions", () => {
  it("should transition state on [EventName] and dispatch [CommandName]", () => {
    const saga = /* your saga definition */;
    const currentState = {
      // TODO: State after the startedBy event
    };

    const reaction = saga.on.[EventName].handle(
      {
        name: "[EventName]",
        payload: { /* TODO */ },
      },
      currentState,
      { /* infrastructure + CQRS buses */ } as any,
    );

    expect(reaction.state).toEqual(/* expected new state */);
    expect(reaction.commands).toEqual(/* expected command(s) */);
  });
});
```

### Handler with no commands only updates state

```ts
import { describe, it, expect } from "vitest";

describe("[SagaName] no-command handler", () => {
  it("should only update state when [EventName] produces no commands", () => {
    const saga = /* your saga definition */;
    const currentState = { /* TODO */ };

    const reaction = saga.on.[EventName].handle(
      {
        name: "[EventName]",
        payload: { /* TODO */ },
      },
      currentState,
      { /* infrastructure + CQRS buses */ } as any,
    );

    expect(reaction.state).toEqual(/* expected state */);
    expect(reaction.commands).toBeUndefined();
  });
});
```

### On map correctly extracts saga instance ID

```ts
import { describe, it, expect } from "vitest";

describe("[SagaName] on map", () => {
  it("should extract the correct saga ID from each event type", () => {
    const saga = /* your saga definition */;

    // Test each on entry's id function
    expect(
      saga.on.[EventName1].id({
        name: "[EventName1]",
        payload: { /* TODO - include the ID field */ },
      }),
    ).toBe(/* expected saga ID */);

    expect(
      saga.on.[EventName2].id({
        name: "[EventName2]",
        payload: { /* TODO - include the ID field */ },
      }),
    ).toBe(/* expected saga ID */);
  });
});
```

### Full saga lifecycle through all steps

```ts
import { describe, it, expect } from "vitest";

describe("[SagaName] full lifecycle", () => {
  it("should complete the full workflow from start to finish", () => {
    const saga = /* your saga definition */;
    let state = saga.initialState;

    // Step 1: Start
    const step1 = saga.on.[StartEventName].handle(
      { name: "[StartEventName]", payload: { /* TODO */ } },
      state,
      { /* infrastructure */ } as any,
    );
    state = step1.state;
    expect(state).toEqual(/* expected state after step 1 */);

    // Step 2: Continue
    const step2 = saga.on.[NextEventName].handle(
      { name: "[NextEventName]", payload: { /* TODO */ } },
      state,
      { /* infrastructure */ } as any,
    );
    state = step2.state;
    expect(state).toEqual(/* expected state after step 2 */);

    // Step N: Complete
    // ...
  });
});
```
