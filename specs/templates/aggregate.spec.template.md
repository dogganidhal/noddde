---
title: "[AggregateName] Aggregate"
module: ddd/[aggregate-name]
source_file: packages/[package]/src/[path]/[aggregate-name].ts
status: draft
exports: [[AggregateName], [AggregateName]Types]
depends_on:
  - core/ddd/aggregate-root
  - core/edd/event
  - core/cqrs/command
docs: []  # Documentation pages covering this module (paths relative to packages/docs/content/docs/)
---

# [AggregateName] Aggregate

> [1-2 sentence summary of what this aggregate models, what invariants it protects, and what business capability it provides.]

## Type Contract

### State

<!--
  Define the aggregate state shape. This is the data the aggregate maintains.
  The state is rebuilt from events (event-sourced) or loaded directly (state-stored).
-->

```ts
type [AggregateName]State = {
  // TODO: Define your aggregate state fields
  // Example:
  // id: string;
  // status: "active" | "suspended" | "closed";
  // balance: number;
};
```

### Events

<!--
  Define all domain events this aggregate can emit. Use DefineEvents for concise unions.
  Events represent facts -- name them in past tense (e.g., AccountCreated, FundsDeposited).
-->

```ts
import type { DefineEvents } from "@noddde/core";

type [AggregateName]Event = DefineEvents<{
  // TODO: Define your events
  // Example:
  // AccountCreated: { id: string; owner: string };
  // FundsDeposited: { amount: number; source: string };
  // AccountSuspended: { reason: string };
}>;
```

### Commands

<!--
  Define all commands this aggregate handles. Use DefineCommands for concise unions.
  Commands represent intent -- name them in imperative mood (e.g., CreateAccount, DepositFunds).
  Use `void` for commands with no payload.
-->

```ts
import type { DefineCommands } from "@noddde/core";

type [AggregateName]Command = DefineCommands<{
  // TODO: Define your commands
  // Example:
  // CreateAccount: { owner: string };
  // DepositFunds: { amount: number; source: string };
  // SuspendAccount: void;
}>;
```

### Ports

<!--
  Define the external dependencies this aggregate's command handlers need.
  Omit if no external dependencies are required (use {}).
-->

```ts
import type { Ports } from "@noddde/core";

interface [AggregateName]Ports extends Ports {
  // TODO: Define external dependencies, or use {} for none
  // Example:
  // clock: { now(): Date };
  // fraudService: { check(amount: number): Promise<boolean> };
}
```

### AggregateTypes Bundle

```ts
type [AggregateName]Types = {
  state: [AggregateName]State;
  events: [AggregateName]Event;
  commands: [AggregateName]Command;
  ports: [AggregateName]Ports;
};
```

## Behavioral Requirements

### Decide Handlers

<!--
  For each command, describe:
  1. What the handler validates/checks before emitting events.
  2. What event(s) are emitted on success.
  3. What happens on failure (throw, return empty array, etc.).
  List each command handler separately.
-->

- **[CommandName]**: [What this command does. Pre-conditions. Events produced. Error conditions.]

### Evolve Handlers

<!--
  For each event, describe how the state changes. Evolve handlers are pure and synchronous.
  They receive (event.payload, currentState) and return newState.
-->

- **[EventName]**: [How state changes when this event is applied.]

## Invariants

<!--
  List the business rules that must always hold true for this aggregate.
  These are checked by command handlers before emitting events.
-->

- [ ] [Invariant 1: e.g., "Balance must never go below zero."]
- [ ] [Invariant 2: e.g., "Account cannot accept commands after being closed."]
- [ ] [Invariant 3]

## Edge Cases

<!--
  Describe unusual scenarios and how the aggregate handles them.
-->

- **[Edge case 1]**: [How it is handled.]
- **[Edge case 2]**: [How it is handled.]

## Integration Points

<!--
  Describe how this aggregate connects to other parts of the system.
-->

- Events produced by this aggregate are consumed by: [projection names, saga names].
- Commands dispatched to this aggregate come from: [UI, sagas, other aggregates].

## Aggregate Definition

<!--
  The actual defineAggregate call. Fill in the handlers.
-->

```ts
import { defineAggregate } from "@noddde/core";

const [AggregateName] = defineAggregate<[AggregateName]Types>({
  initialState: {
    // TODO: Set your zero-value state
  },
  decide: {
    // TODO: Implement decide handlers
    // [CommandName]: (command, state, ports) => {
    //   // validate, then return event(s)
    //   return { name: "[EventName]", payload: { ... } };
    // },
  },
  evolve: {
    // TODO: Implement evolve handlers
    // [EventName]: (payload, state) => {
    //   return { ...state, ... };
    // },
  },
});
```

## Test Scenarios

### [Command handler scenario name]

<!--
  Write a test for each command handler. Verify:
  - Correct events are returned given valid input and state.
  - Invariant violations throw or produce error events.
  - Apply handlers produce the expected new state.
-->

```ts
import { describe, it, expect } from "vitest";
import { defineAggregate } from "@noddde/core";

describe("[AggregateName]", () => {
  // TODO: Import or inline your aggregate definition

  it("should [expected behavior] when [CommandName] is dispatched", () => {
    const aggregate = /* your aggregate definition */;
    const state = aggregate.initialState;

    const events = aggregate.decide.[CommandName](
      {
        name: "[CommandName]",
        targetAggregateId: "test-id",
        payload: { /* TODO */ },
      },
      state,
      { /* infrastructure */ },
    );

    // Verify events
    expect(events).toEqual(/* expected events */);

    // Evolve and verify state
    const newState = Array.isArray(events)
      ? events.reduce(
          (s, e) => aggregate.evolve[e.name](e.payload, s),
          state,
        )
      : aggregate.evolve[events.name](events.payload, state);

    expect(newState).toEqual(/* expected state */);
  });
});
```

### [Invariant violation scenario name]

```ts
import { describe, it, expect } from "vitest";

describe("[AggregateName] invariant enforcement", () => {
  it("should reject [CommandName] when [invariant description]", () => {
    const aggregate = /* your aggregate definition */;
    const invalidState = { /* state that violates the invariant */ };

    expect(() =>
      aggregate.decide.[CommandName](
        {
          name: "[CommandName]",
          targetAggregateId: "test-id",
          payload: { /* TODO */ },
        },
        invalidState,
        { /* infrastructure */ },
      ),
    ).toThrow(/* expected error */);
  });
});
```

### Evolve handlers produce correct state transitions

```ts
import { describe, it, expect } from "vitest";

describe("[AggregateName] evolve handlers", () => {
  it("should evolve state correctly for [EventName]", () => {
    const aggregate = /* your aggregate definition */;

    const newState = aggregate.evolve.[EventName](
      { /* event payload */ },
      aggregate.initialState,
    );

    expect(newState).toEqual(/* expected state */);
  });
});
```
