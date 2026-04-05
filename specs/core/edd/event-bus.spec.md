---
title: "EventBus"
module: edd/event-bus
source_file: packages/core/src/edd/event-bus.ts
status: implemented
exports: [EventBus]
depends_on: [edd/event]
docs:
  - events/event-bus.mdx
---

# EventBus

> The `EventBus` interface defines the contract for publishing domain events to all registered listeners. It is the backbone of the read-side update mechanism in CQRS, responsible for routing events to projections, event handlers, and sagas.

## Type Contract

- **`EventBus`** is an interface with a single method:
  - `dispatch<TEvent extends Event>(event: TEvent): Promise<void>` -- publishes one domain event.
- The method is generic over `TEvent`, preserving the concrete event type at the call site.
- The return type is `Promise<void>`, indicating asynchronous, fire-and-forget dispatch.

## Behavioral Requirements

- `dispatch` accepts any value that satisfies the `Event` interface (structural typing).
- The generic parameter `TEvent` enables implementations to access the narrowed event type, but the interface itself does not constrain which events can be dispatched.
- `dispatch` returns a `Promise<void>`, meaning callers must `await` it or handle the promise.
- The interface is designed for single-event dispatch (not batch).

## Invariants

- Any object implementing `EventBus` must have a `dispatch` method that accepts any `Event` subtype.
- The return type is always `Promise<void>` regardless of the event type.
- The interface makes no guarantees about ordering, delivery, or idempotency -- those are implementation concerns.

## Edge Cases

- **Dispatch with a plain `Event`**: Should compile, since `Event` extends itself.
- **Dispatch with a narrowed event type**: The generic preserves the literal `name` and typed `payload`.
- **Void return**: Implementations that are synchronous internally still must return a `Promise<void>`.

## Integration Points

- `EventBus` is a member of `CQRSPorts`, making it available to standalone command handlers and saga event handlers.
- The engine/runtime uses `EventBus` to publish events after aggregate command handling.
- Projections and event handlers subscribe to events through the `EventBus`.

## Test Scenarios

### EventBus dispatch accepts any Event subtype

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventBus, Event, DefineEvents } from "@noddde/core";

describe("EventBus", () => {
  it("should accept a base Event", () => {
    const bus: EventBus = {
      dispatch: async (_event: Event) => {},
    };
    expectTypeOf(bus.dispatch).parameter(0).toMatchTypeOf<Event>();
  });

  it("should accept a narrowed event type", () => {
    type OrderEvent = DefineEvents<{ OrderPlaced: { orderId: string } }>;
    const bus = {} as EventBus;
    const event: OrderEvent = {
      name: "OrderPlaced",
      payload: { orderId: "1" },
    };
    expectTypeOf(bus.dispatch(event)).toEqualTypeOf<Promise<void>>();
  });

  it("should return Promise<void>", () => {
    const bus = {} as EventBus;
    const result = bus.dispatch({ name: "test", payload: {} });
    expectTypeOf(result).toEqualTypeOf<Promise<void>>();
  });
});
```

### EventBus can be implemented structurally

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventBus } from "@noddde/core";

describe("EventBus structural implementation", () => {
  it("should allow any object with a matching dispatch method", () => {
    const myBus = {
      dispatch: async () => {},
    };
    expectTypeOf(myBus).toMatchTypeOf<EventBus>();
  });
});
```
