---
title: "Upcaster (Event Versioning)"
module: edd/upcaster
source_file: packages/core/src/edd/upcaster.ts
status: implemented
exports:
  - TypedEventUpcasterChain
  - UpcasterMap
  - StepsFromVersions
  - Last
  - defineEventUpcasterChain
  - defineUpcasters
  - upcastEvent
  - upcastEvents
  - currentEventVersion
depends_on:
  - edd/event
  - edd/event-metadata
docs:
  - modeling/event-versioning.mdx
---

# Upcaster (Event Versioning)

> Provides a type-safe, functional API for evolving event schemas over time. Upcasters are pure, synchronous functions that transform event payloads from one schema version to the next, forming ordered chains per event name. When replaying historical events during aggregate rehydration, the engine applies upcaster chains to bring old payloads up to the current version before feeding them to apply handlers.

## Type Contract

### `TypedEventUpcasterChain<TOutput>`

A phantom-branded array type that carries the chain's final output type at the type level:

```typescript
type TypedEventUpcasterChain<TOutput> = Array<(payload: any) => any> & {
  readonly __outputType?: TOutput;
};
```

- At runtime, a plain `Array<(payload: any) => any>`.
- The phantom `__outputType` field exists only at the type level to enable `UpcasterMap` to validate that the chain's final output matches the current event payload.

### `UpcasterMap<TEvents extends Event>`

A mapped type that associates event names with their typed upcaster chains:

```typescript
type UpcasterMap<TEvents extends Event = Event> = {
  [K in TEvents["name"]]?: TypedEventUpcasterChain<
    Extract<TEvents, { name: K }>["payload"]
  >;
};
```

- Keys are constrained to valid event names from `TEvents`.
- Each chain's `TOutput` phantom type must be assignable to the corresponding event's current payload type.
- Only events that have undergone schema changes need entries; omitted events are assumed to be at version 1.

### `StepsFromVersions<T extends any[]>`

A recursive mapped tuple type that generates step function signatures from a version tuple:

```typescript
type StepsFromVersions<T extends any[]> = T extends [
  infer V1,
  infer V2,
  ...infer Rest,
]
  ? [(payload: V1) => V2, ...StepsFromVersions<[V2, ...Rest]>]
  : [];
```

- `StepsFromVersions<[A, B, C]>` expands to `[(payload: A) => B, (payload: B) => C]`.
- Works for any tuple length (limited only by TypeScript's recursion depth).

### `Last<T extends any[]>`

Extracts the last element of a tuple type:

```typescript
type Last<T extends any[]> = T extends [...any[], infer L] ? L : never;
```

### `defineEventUpcasterChain<TVersions>(...steps)`

Creates a typed upcaster chain from a version tuple:

```typescript
function defineEventUpcasterChain<TVersions extends [any, any, ...any[]]>(
  ...steps: StepsFromVersions<TVersions>
): TypedEventUpcasterChain<Last<TVersions>>;
```

- `TVersions` must be explicitly provided as a generic (TypeScript cannot infer it from the steps).
- Each step's input type is derived from the corresponding tuple element.
- Each step's return type is validated against the next tuple element.
- Returns a `TypedEventUpcasterChain<Last<TVersions>>`, enabling `UpcasterMap` to validate the chain output against the current event payload.

### `defineUpcasters<TEvents>(map)`

Identity function for creating type-safe upcaster maps:

```typescript
function defineUpcasters<TEvents extends Event>(
  upcasters: UpcasterMap<TEvents>,
): UpcasterMap<TEvents>;
```

### `upcastEvent(event, upcasters)`

Applies an upcaster chain to a single event:

```typescript
function upcastEvent(event: Event, upcasters: UpcasterMap): Event;
```

- Returns a new `Event` object with the upcasted payload. Never mutates the input.

### `upcastEvents(events, upcasters)`

Applies upcaster chains to an array of events:

```typescript
function upcastEvents(events: Event[], upcasters: UpcasterMap): Event[];
```

### `currentEventVersion(eventName, upcasters)`

Returns the current schema version for an event name:

```typescript
function currentEventVersion(eventName: string, upcasters: UpcasterMap): number;
```

## Behavioral Requirements

1. **`upcastEvent` returns the event unchanged when no chain exists** for the event's `name` in the upcaster map.
2. **`upcastEvent` treats events without `metadata.version` as version 1** — this handles events persisted before versioning was introduced.
3. **`upcastEvent` applies steps sequentially from `storedVersion - 1` to `chain.length - 1`** — for a version 2 event with a 3-step chain (v1→v2→v3→v4), only steps at index 1 and 2 are applied.
4. **`upcastEvent` returns the event unchanged when `storedVersion >= currentVersion`** — events already at or beyond the current version need no transformation (forward compatibility).
5. **`upcastEvent` returns a new event object** — the input event is never mutated; the returned event has the same `name` and `metadata` but a new `payload`.
6. **`currentEventVersion` returns `chain.length + 1`** for events with a chain, or `1` for events without a chain.
7. **`upcastEvents` applies `upcastEvent` to each event in the array** in order, returning a new array.
8. **`defineEventUpcasterChain` enforces step-to-step type safety** — step N's input type is `TVersions[N]` and its return type must be assignable to `TVersions[N+1]`.
9. **`defineEventUpcasterChain` enforces final-output type safety** — the returned `TypedEventUpcasterChain<Last<TVersions>>` carries the phantom brand so `UpcasterMap` can validate the chain output matches the current event payload.
10. **`defineUpcasters` enforces event name validation** — only keys that exist in `TEvents["name"]` are allowed.
11. **Upcaster steps are pure and synchronous** — like apply handlers, they take a payload and return a new payload with no side effects.

## Invariants

- `upcastEvent` always returns an `Event` that is structurally identical to the input except for `payload`.
- `upcastEvent` never mutates the input event or its payload.
- For any event, `upcastEvent(event, {})` === the original event (identity for empty map).
- `currentEventVersion(name, map)` is always >= 1.
- Version numbering starts at 1, never 0.
- A chain with 0 steps (`[]`) is equivalent to no chain (current version = 1).
- `StepsFromVersions<[A]>` produces `[]` (a single-element tuple has no transitions).
- `StepsFromVersions<[A, B]>` produces `[(payload: A) => B]`.

## Edge Cases

- **Event name not in upcaster map**: `upcastEvent` returns the event unchanged.
- **Event already at current version**: `upcastEvent` returns the event unchanged.
- **Future event** (`metadata.version > currentVersion`): returned unchanged (supports rolling deployments where a newer writer may produce events the current version doesn't know about).
- **Empty upcaster map** (`{}`): all events pass through unchanged.
- **`metadata` is undefined**: treated as version 1.
- **`metadata.version` is undefined but `metadata` exists**: treated as version 1.
- **Chain with zero steps** (`[]`): current version is 1, no transforms applied.
- **Version 1 event with a 1-step chain**: step at index 0 is applied (transforms v1 to v2).

## Integration Points

- **`Aggregate<T>.upcasters?`** — the optional field on aggregate definitions (in `ddd/aggregate-root.ts`) holds the `UpcasterMap<T["events"]>` for that aggregate's events.
- **`CommandLifecycleExecutor`** — applies `upcastEvents()` to loaded events before replaying them through apply handlers (both standard and snapshot paths).
- **`MetadataEnricher`** — uses `currentEventVersion()` to stamp `metadata.version` on newly produced events.
- **`Domain.init()`** — validates upcaster chains at startup (each chain must be an array of functions).

## Test Scenarios

### upcastEvent returns event unchanged when no chain exists

```ts
import { describe, it, expect } from "vitest";
import { upcastEvent } from "@noddde/core";
import type { Event } from "@noddde/core";

describe("upcastEvent with no chain", () => {
  it("should return the event unchanged when no chain exists for its name", () => {
    const event: Event = { name: "OrderPlaced", payload: { orderId: "123" } };
    const result = upcastEvent(event, {});
    expect(result).toBe(event);
  });
});
```

### upcastEvent treats missing metadata.version as version 1

```ts
import { describe, it, expect } from "vitest";
import {
  upcastEvent,
  defineEventUpcasterChain,
  defineUpcasters,
} from "@noddde/core";
import type { Event, DefineEvents } from "@noddde/core";

describe("upcastEvent with missing version", () => {
  type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;

  it("should treat events without metadata.version as version 1 and apply the chain", () => {
    const upcasters = defineUpcasters<TestEvent>({
      Created: defineEventUpcasterChain<
        [{ id: string }, { id: string; status: string }]
      >((v1) => ({ ...v1, status: "active" })),
    });

    const event: Event = { name: "Created", payload: { id: "1" } };
    const result = upcastEvent(event, upcasters);
    expect(result.payload).toEqual({ id: "1", status: "active" });
  });

  it("should treat events with metadata but no version as version 1", () => {
    const upcasters = defineUpcasters<TestEvent>({
      Created: defineEventUpcasterChain<
        [{ id: string }, { id: string; status: string }]
      >((v1) => ({ ...v1, status: "active" })),
    });

    const event: Event = {
      name: "Created",
      payload: { id: "1" },
      metadata: {
        eventId: "evt-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        correlationId: "corr-1",
        causationId: "cmd-1",
      },
    };
    const result = upcastEvent(event, upcasters);
    expect(result.payload).toEqual({ id: "1", status: "active" });
  });
});
```

### upcastEvent applies steps sequentially from stored version

```ts
import { describe, it, expect } from "vitest";
import {
  upcastEvent,
  defineEventUpcasterChain,
  defineUpcasters,
} from "@noddde/core";
import type { Event, DefineEvents } from "@noddde/core";

describe("upcastEvent multi-step chain", () => {
  type V1 = { id: string };
  type V2 = { id: string; status: string };
  type V3 = { id: string; status: string; createdAt: string };

  type TestEvent = DefineEvents<{ Created: V3 }>;

  const upcasters = defineUpcasters<TestEvent>({
    Created: defineEventUpcasterChain<[V1, V2, V3]>(
      (v1) => ({ ...v1, status: "active" }),
      (v2) => ({ ...v2, createdAt: "2024-01-01" }),
    ),
  });

  it("should apply all steps for a v1 event", () => {
    const event: Event = { name: "Created", payload: { id: "1" } };
    const result = upcastEvent(event, upcasters);
    expect(result.payload).toEqual({
      id: "1",
      status: "active",
      createdAt: "2024-01-01",
    });
  });

  it("should apply only remaining steps for a v2 event", () => {
    const event: Event = {
      name: "Created",
      payload: { id: "1", status: "active" },
      metadata: {
        eventId: "evt-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        correlationId: "corr-1",
        causationId: "cmd-1",
        version: 2,
      },
    };
    const result = upcastEvent(event, upcasters);
    expect(result.payload).toEqual({
      id: "1",
      status: "active",
      createdAt: "2024-01-01",
    });
  });
});
```

### upcastEvent returns event unchanged when already at current version

```ts
import { describe, it, expect } from "vitest";
import {
  upcastEvent,
  defineEventUpcasterChain,
  defineUpcasters,
} from "@noddde/core";
import type { Event, DefineEvents } from "@noddde/core";

describe("upcastEvent at current version", () => {
  type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;

  const upcasters = defineUpcasters<TestEvent>({
    Created: defineEventUpcasterChain<
      [{ id: string }, { id: string; status: string }]
    >((v1) => ({ ...v1, status: "active" })),
  });

  it("should return the event unchanged when already at current version", () => {
    const event: Event = {
      name: "Created",
      payload: { id: "1", status: "active" },
      metadata: {
        eventId: "evt-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        correlationId: "corr-1",
        causationId: "cmd-1",
        version: 2,
      },
    };
    const result = upcastEvent(event, upcasters);
    expect(result).toBe(event);
  });
});
```

### upcastEvent returns event unchanged for future versions

```ts
import { describe, it, expect } from "vitest";
import {
  upcastEvent,
  defineEventUpcasterChain,
  defineUpcasters,
} from "@noddde/core";
import type { Event, DefineEvents } from "@noddde/core";

describe("upcastEvent future version", () => {
  type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;

  const upcasters = defineUpcasters<TestEvent>({
    Created: defineEventUpcasterChain<
      [{ id: string }, { id: string; status: string }]
    >((v1) => ({ ...v1, status: "active" })),
  });

  it("should return the event unchanged when version is higher than current", () => {
    const event: Event = {
      name: "Created",
      payload: { id: "1", status: "active", futureField: true },
      metadata: {
        eventId: "evt-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        correlationId: "corr-1",
        causationId: "cmd-1",
        version: 99,
      },
    };
    const result = upcastEvent(event, upcasters);
    expect(result).toBe(event);
  });
});
```

### upcastEvent never mutates the input

```ts
import { describe, it, expect } from "vitest";
import {
  upcastEvent,
  defineEventUpcasterChain,
  defineUpcasters,
} from "@noddde/core";
import type { Event, DefineEvents } from "@noddde/core";

describe("upcastEvent immutability", () => {
  type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;

  it("should not mutate the original event or payload", () => {
    const upcasters = defineUpcasters<TestEvent>({
      Created: defineEventUpcasterChain<
        [{ id: string }, { id: string; status: string }]
      >((v1) => ({ ...v1, status: "active" })),
    });

    const originalPayload = { id: "1" };
    const event: Event = { name: "Created", payload: originalPayload };
    const result = upcastEvent(event, upcasters);

    expect(result).not.toBe(event);
    expect(result.payload).not.toBe(originalPayload);
    expect(originalPayload).toEqual({ id: "1" });
    expect(event.payload).toEqual({ id: "1" });
  });
});
```

### currentEventVersion returns chain.length + 1 or 1

```ts
import { describe, it, expect } from "vitest";
import {
  currentEventVersion,
  defineEventUpcasterChain,
  defineUpcasters,
} from "@noddde/core";
import type { DefineEvents } from "@noddde/core";

describe("currentEventVersion", () => {
  type TestEvent = DefineEvents<{
    Created: { id: string; status: string; createdAt: string };
    Updated: { id: string };
  }>;

  const upcasters = defineUpcasters<TestEvent>({
    Created: defineEventUpcasterChain<
      [
        { id: string },
        { id: string; status: string },
        { id: string; status: string; createdAt: string },
      ]
    >(
      (v1) => ({ ...v1, status: "active" }),
      (v2) => ({ ...v2, createdAt: "2024-01-01" }),
    ),
  });

  it("should return chain.length + 1 for events with a chain", () => {
    expect(currentEventVersion("Created", upcasters)).toBe(3);
  });

  it("should return 1 for events without a chain", () => {
    expect(currentEventVersion("Updated", upcasters)).toBe(1);
  });

  it("should return 1 for unknown event names", () => {
    expect(currentEventVersion("NonExistent", upcasters)).toBe(1);
  });
});
```

### upcastEvents applies upcasting to each event in array

```ts
import { describe, it, expect } from "vitest";
import {
  upcastEvents,
  defineEventUpcasterChain,
  defineUpcasters,
} from "@noddde/core";
import type { Event, DefineEvents } from "@noddde/core";

describe("upcastEvents", () => {
  type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;

  it("should upcast each event in the array", () => {
    const upcasters = defineUpcasters<TestEvent>({
      Created: defineEventUpcasterChain<
        [{ id: string }, { id: string; status: string }]
      >((v1) => ({ ...v1, status: "active" })),
    });

    const events: Event[] = [
      { name: "Created", payload: { id: "1" } },
      { name: "Created", payload: { id: "2" } },
      { name: "Unknown", payload: {} },
    ];

    const results = upcastEvents(events, upcasters);
    expect(results).toHaveLength(3);
    expect(results[0]!.payload).toEqual({ id: "1", status: "active" });
    expect(results[1]!.payload).toEqual({ id: "2", status: "active" });
    expect(results[2]).toBe(events[2]);
  });
});
```

### defineEventUpcasterChain enforces type safety via version tuple

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  TypedEventUpcasterChain,
  StepsFromVersions,
  Last,
  UpcasterMap,
  DefineEvents,
} from "@noddde/core";

describe("defineEventUpcasterChain type safety", () => {
  it("should derive step types from version tuple", () => {
    type V1 = { id: string };
    type V2 = { id: string; status: string };
    type Steps = StepsFromVersions<[V1, V2]>;
    expectTypeOf<Steps>().toEqualTypeOf<[(payload: V1) => V2]>();
  });

  it("should derive multi-step types from version tuple", () => {
    type V1 = { id: string };
    type V2 = { id: string; status: string };
    type V3 = { id: string; status: string; createdAt: string };
    type Steps = StepsFromVersions<[V1, V2, V3]>;
    expectTypeOf<Steps>().toEqualTypeOf<
      [(payload: V1) => V2, (payload: V2) => V3]
    >();
  });

  it("should extract last element of tuple", () => {
    expectTypeOf<Last<[string, number, boolean]>>().toEqualTypeOf<boolean>();
    expectTypeOf<Last<[string]>>().toEqualTypeOf<string>();
  });

  it("should produce empty steps for single-element tuple", () => {
    type Steps = StepsFromVersions<[{ id: string }]>;
    expectTypeOf<Steps>().toEqualTypeOf<[]>();
  });

  it("should constrain UpcasterMap keys to valid event names", () => {
    type TestEvent = DefineEvents<{
      Created: { id: string };
      Updated: { name: string };
    }>;
    type Map = UpcasterMap<TestEvent>;
    expectTypeOf<Map>().toHaveProperty("Created");
    expectTypeOf<Map>().toHaveProperty("Updated");
  });

  it("should constrain chain output to match current event payload", () => {
    type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;
    type Map = UpcasterMap<TestEvent>;

    // Valid: chain output matches current payload
    expectTypeOf<
      TypedEventUpcasterChain<{ id: string; status: string }>
    >().toMatchTypeOf<NonNullable<Map["Created"]>>();
  });
});
```

### defineUpcasters validates event name keys

```ts
import { describe, it, expectTypeOf } from "vitest";
import { defineUpcasters } from "@noddde/core";
import type { DefineEvents, UpcasterMap } from "@noddde/core";

describe("defineUpcasters", () => {
  type TestEvent = DefineEvents<{
    Created: { id: string };
    Updated: { value: number };
  }>;

  it("should return the same map with correct typing", () => {
    const upcasters = defineUpcasters<TestEvent>({});
    expectTypeOf(upcasters).toMatchTypeOf<UpcasterMap<TestEvent>>();
  });

  it("should accept an empty map", () => {
    const upcasters = defineUpcasters<TestEvent>({});
    expectTypeOf(upcasters).toMatchTypeOf<UpcasterMap<TestEvent>>();
  });
});
```
