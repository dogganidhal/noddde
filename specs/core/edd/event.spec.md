---
title: "Event & DefineEvents"
module: edd/event
source_file: packages/core/src/edd/event.ts
status: implemented
exports: [Event, DefineEvents]
depends_on: []
docs:
  - events/defining-events.mdx
  - events/event-sourcing.mdx
---

# Event & DefineEvents

> The `Event` interface is the base contract for all domain events in the framework. Events represent immutable facts that have already occurred. `DefineEvents` is a mapped-type utility that builds a discriminated union of concrete event types from a simple payload map, eliminating boilerplate interface declarations.

## Type Contract

- **`Event`** is an interface with two fields:
  - `name: string` -- the discriminant used for type narrowing.
  - `payload: any` -- the data describing what happened.
- **`DefineEvents<TPayloads>`** accepts a `Record<string, any>` and produces a discriminated union where each member has:
  - `name` narrowed to the literal key `K`.
  - `payload` typed as `TPayloads[K]`.
- The resulting union is a subtype of `Event` (each member satisfies `{ name: string; payload: any }`).

## Behavioral Requirements

- `Event` is a structural interface; any object with `name: string` and `payload: any` satisfies it.
- `DefineEvents` maps over all keys of `TPayloads` that are strings (`keyof TPayloads & string`), producing one object type per key, then collapses them into a union via indexed access.
- Each union member's `name` is a string literal, enabling exhaustive `switch`/`if` narrowing.
- `payload` types are preserved exactly as declared in the input map.

## Invariants

- Every member of a `DefineEvents` union is assignable to `Event`.
- The `name` field of each union member is a literal type, not `string`.
- The union has exactly as many members as keys in `TPayloads`.
- A single-key payload map produces a plain object type, not a union.
- `DefineEvents` distributes over all keys -- it does not collapse payload types.

## Edge Cases

- **Single event**: `DefineEvents<{ A: number }>` yields `{ name: "A"; payload: number }` (not a union).
- **Empty record**: `DefineEvents<{}>` produces `never` because there are no keys to map over.
- **`any` payload**: `DefineEvents<{ Foo: any }>` yields `{ name: "Foo"; payload: any }`.
- **`never` payload**: `DefineEvents<{ Foo: never }>` yields `{ name: "Foo"; payload: never }`.
- **Numeric keys are excluded**: Only `string` keys participate (`keyof TPayloads & string`).

## Integration Points

- `Event` is the base constraint for `ApplyHandler`, `EventHandler`, `EventBus.dispatch`, and all aggregate/projection/saga type bundles.
- `DefineEvents` is the primary way users define their event unions, which then flow into `AggregateTypes["events"]`, `ProjectionTypes["events"]`, and `SagaTypes["events"]`.

## Test Scenarios

### Event interface accepts any conforming object

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Event } from "@noddde/core";

describe("Event", () => {
  it("should accept an object with name and payload", () => {
    const event: Event = { name: "OrderPlaced", payload: { orderId: "123" } };
    expectTypeOf(event.name).toBeString();
    expectTypeOf(event.payload).toBeAny();
  });

  it("should accept any string as name", () => {
    const event: Event = { name: "anything", payload: null };
    expectTypeOf(event).toMatchTypeOf<Event>();
  });
});
```

### DefineEvents produces a discriminated union

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineEvents } from "@noddde/core";

describe("DefineEvents", () => {
  type AccountEvent = DefineEvents<{
    AccountCreated: { id: string; owner: string };
    DepositMade: { amount: number };
  }>;

  it("should produce a union of two event types", () => {
    expectTypeOf<AccountEvent>().toMatchTypeOf<
      | { name: "AccountCreated"; payload: { id: string; owner: string } }
      | { name: "DepositMade"; payload: { amount: number } }
    >();
  });

  it("should allow narrowing by name", () => {
    const handle = (event: AccountEvent) => {
      if (event.name === "AccountCreated") {
        expectTypeOf(event).toMatchTypeOf<{
          name: "AccountCreated";
          payload: { id: string; owner: string };
        }>();
      }
    };
    expectTypeOf(handle).toBeFunction();
  });

  it("should be assignable to Event", () => {
    expectTypeOf<AccountEvent>().toMatchTypeOf<import("@noddde/core").Event>();
  });
});
```

### DefineEvents with single event produces a non-union type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineEvents } from "@noddde/core";

describe("DefineEvents with single key", () => {
  type SingleEvent = DefineEvents<{ OrderPlaced: { orderId: string } }>;

  it("should produce a single object type", () => {
    expectTypeOf<SingleEvent>().toEqualTypeOf<{
      name: "OrderPlaced";
      payload: { orderId: string };
    }>();
  });
});
```

### DefineEvents with empty record produces never

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineEvents } from "@noddde/core";

describe("DefineEvents with empty record", () => {
  type NoEvents = DefineEvents<{}>;

  it("should produce never", () => {
    expectTypeOf<NoEvents>().toBeNever();
  });
});
```
