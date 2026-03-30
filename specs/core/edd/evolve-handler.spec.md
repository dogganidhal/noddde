---
title: "EvolveHandler"
module: edd/event-sourcing-handler
source_file: packages/core/src/edd/event-sourcing-handler.ts
status: implemented
exports: [EvolveHandler]
depends_on: [edd/event]
docs:
  - events/evolve-handlers.mdx
---

# EvolveHandler

> `EvolveHandler` is a pure, synchronous function type that evolves aggregate state in response to an event. It is the replay engine of event sourcing -- deterministic and free of side effects so that replaying events always produces the same state.

## Type Contract

- **`EvolveHandler<TEvent, TState>`** is a function type:
  - First parameter: `event: TEvent["payload"]` -- the event payload (not the full envelope).
  - Second parameter: `state: TState` -- the current aggregate state before this event.
  - Return type: `TState` -- the new aggregate state after applying this event.
- `TEvent` is constrained to `extends Event`.
- `TState` is unconstrained (can be any type).

## Behavioral Requirements

- The handler receives the unwrapped event payload, not the full event object.
- The handler must return a new state value of the same type `TState`.
- The handler must be pure: no side effects, no I/O, no infrastructure access.
- The handler must be synchronous: no `Promise` in the return type.
- State should be treated as immutable -- the handler returns a new state object rather than mutating the input.

## Invariants

- The return type is exactly `TState`, not `TState | Promise<TState>`.
- No infrastructure parameter is present -- evolve handlers are deliberately isolated from I/O.
- The first parameter type is `TEvent["payload"]`, consistent with `EventHandler`.
- The function signature enforces the event sourcing constraint: state evolution depends only on the event payload and current state.

## Edge Cases

- **Identity handler**: `(_, state) => state` is valid -- the event has no effect on state.
- **State type is a primitive**: `EvolveHandler<SomeEvent, number>` is valid; returns a `number`.
- **Event with `any` payload**: First parameter becomes `any`.
- **State type is `never`**: Makes the handler uncallable in practice.
- **Returning a partial state**: TypeScript will catch this as a type error since the return must be the full `TState`.

## Integration Points

- `EvolveHandler` is used in `EvolveHandlerMap` inside the `Aggregate` interface, where one handler is required per event name.
- It is also used in projection reducers conceptually (though projections use a slightly different signature that receives the full event).
- The purity constraint is a design-time contract -- the type system does not enforce absence of side effects at runtime.

## Test Scenarios

### EvolveHandler evolves state from event payload

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EvolveHandler, DefineEvents } from "@noddde/core";

describe("EvolveHandler", () => {
  type CounterEvent = DefineEvents<{
    Incremented: { amount: number };
  }>;
  type IncrementedEvent = Extract<CounterEvent, { name: "Incremented" }>;
  type CounterState = { count: number };

  type Handler = EvolveHandler<IncrementedEvent, CounterState>;

  it("should accept event payload as first parameter", () => {
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<{ amount: number }>();
  });

  it("should accept state as second parameter", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<CounterState>();
  });

  it("should return the same state type", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<CounterState>();
  });
});
```

### EvolveHandler is synchronous (no Promise return)

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EvolveHandler, Event } from "@noddde/core";

describe("EvolveHandler synchronous constraint", () => {
  type Handler = EvolveHandler<Event, { value: string }>;

  it("should not return a Promise", () => {
    expectTypeOf<ReturnType<Handler>>().not.toMatchTypeOf<Promise<any>>();
  });

  it("should return the state type directly", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<{ value: string }>();
  });
});
```

### EvolveHandler works with primitive state

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EvolveHandler, DefineEvents } from "@noddde/core";

describe("EvolveHandler with primitive state", () => {
  type MyEvent = DefineEvents<{ ValueSet: { value: number } }>;
  type Handler = EvolveHandler<Extract<MyEvent, { name: "ValueSet" }>, number>;

  it("should accept and return a number", () => {
    expectTypeOf<Parameters<Handler>[1]>().toBeNumber();
    expectTypeOf<ReturnType<Handler>>().toBeNumber();
  });
});
```

### EvolveHandler runtime behavior

```ts
import { describe, it, expect } from "vitest";
import type { EvolveHandler, DefineEvents } from "@noddde/core";

describe("EvolveHandler runtime", () => {
  type CounterEvent = DefineEvents<{ Incremented: { amount: number } }>;

  it("should produce new state from payload and current state", () => {
    const evolve: EvolveHandler<
      Extract<CounterEvent, { name: "Incremented" }>,
      { count: number }
    > = (payload, state) => ({
      count: state.count + payload.amount,
    });

    const result = evolve({ amount: 5 }, { count: 10 });
    expect(result).toEqual({ count: 15 });
  });
});
```
