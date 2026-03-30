---
title: "Event & DefineEvents"
module: edd/event
source_file: packages/core/src/edd/event.ts
status: implemented
exports: [Event, DefineEvents]
depends_on: [edd/event-metadata]
docs:
  - events/defining-events.mdx
  - events/event-sourcing.mdx
---

# Event & DefineEvents

> The `Event` interface is the base contract for all domain events in the framework. Events represent immutable facts that have already occurred. `DefineEvents` is a mapped-type utility that builds a discriminated union of concrete event types from a simple payload map, eliminating boilerplate interface declarations.

## Type Contract

- **`Event`** is an interface with three fields:
  - `name: string` -- the discriminant used for type narrowing.
  - `payload: any` -- the data describing what happened.
  - `metadata?: EventMetadata` -- optional metadata envelope populated by the framework at dispatch time.
- **`DefineEvents<TPayloads>`** accepts a `Record<string, any>` and produces a discriminated union where each member has:
  - `name` narrowed to the literal key `K`.
  - `payload` typed as `TPayloads[K]`.
- The resulting union is a subtype of `Event` (each member satisfies `{ name: string; payload: any }` and metadata is optional, so omission is valid).

## Behavioral Requirements

- `Event` is a structural interface; any object with `name: string` and `payload: any` satisfies it (metadata is optional).
- The `metadata` field is optional (`?`), so events created without metadata (e.g., by command handlers) are valid `Event` instances.
- `DefineEvents` maps over all keys of `TPayloads` that are strings (`keyof TPayloads & string`), producing one object type per key, then collapses them into a union via indexed access.
- Each union member's `name` is a string literal, enabling exhaustive `switch`/`if` narrowing.
- `payload` types are preserved exactly as declared in the input map.
- `DefineEvents` output does not include `metadata` in its generated type — the field is inherited from the `Event` base interface and is structurally compatible because it is optional.

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

- `Event` is the base constraint for `EvolveHandler`, `EventHandler`, `EventBus.dispatch`, and all aggregate/projection/saga type bundles.
- `DefineEvents` is the primary way users define their event unions, which then flow into `AggregateTypes["events"]`, `ProjectionTypes["events"]`, and `SagaTypes["events"]`.
- `EventMetadata` is imported from `edd/event-metadata` and referenced as the type of the optional `metadata` field.
- The engine's `Domain` class populates the `metadata` field during command dispatch — events enter persistence and the event bus with metadata attached.

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

### Event accepts optional metadata

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Event, EventMetadata } from "@noddde/core";

describe("Event metadata", () => {
  it("should accept an event without metadata", () => {
    const event: Event = { name: "OrderPlaced", payload: { orderId: "123" } };
    expectTypeOf(event).toMatchTypeOf<Event>();
  });

  it("should accept an event with metadata", () => {
    const event: Event = {
      name: "OrderPlaced",
      payload: { orderId: "123" },
      metadata: {
        eventId: "0190a6e0-0000-7000-8000-000000000001",
        timestamp: "2024-01-01T00:00:00.000Z",
        correlationId: "corr-1",
        causationId: "cmd-1",
      },
    };
    expectTypeOf(event).toMatchTypeOf<Event>();
  });

  it("should have metadata typed as EventMetadata or undefined", () => {
    expectTypeOf<Event["metadata"]>().toEqualTypeOf<
      EventMetadata | undefined
    >();
  });
});
```

### DefineEvents output is assignable to Event with metadata

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineEvents, Event } from "@noddde/core";

describe("DefineEvents assignability with metadata", () => {
  type MyEvent = DefineEvents<{ Created: { id: string } }>;

  it("should be assignable to Event (metadata is optional)", () => {
    expectTypeOf<MyEvent>().toMatchTypeOf<Event>();
  });
});
```
