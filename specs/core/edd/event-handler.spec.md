---
title: "EventHandler"
module: edd/event-handler
source_file: packages/core/src/edd/event-handler.ts
status: implemented
exports: [EventHandler]
depends_on: [edd/event, infrastructure/index]
docs:
  - events/event-handlers.mdx
---

# EventHandler

> `EventHandler` is an impure, async-capable function type that reacts to domain events. Unlike the pure `ApplyHandler`, event handlers have access to infrastructure and may perform I/O such as updating read models, sending notifications, or triggering downstream processes.

## Type Contract

- **`EventHandler<TEvent, TInfrastructure>`** is a function type:
  - First parameter: `event: TEvent["payload"]` -- receives the event's payload, not the full event envelope.
  - Second parameter: `infrastructure: TInfrastructure` -- external dependencies.
  - Return type: `void | Promise<void>` -- may be sync or async; no return value expected.
- `TEvent` is constrained to `extends Event`.
- `TInfrastructure` is constrained to `extends Infrastructure`.

## Behavioral Requirements

- The handler receives the unwrapped payload, not the full event object. This is a deliberate design choice that distinguishes it from saga event handlers (which receive the full event).
- The handler may perform side effects: I/O, external calls, state mutations.
- Returning `void` (synchronous) or `Promise<void>` (asynchronous) are both valid.
- Infrastructure provides access to repositories, services, and other external dependencies.

## Invariants

- The first parameter type is always `TEvent["payload"]`, indexing into the event's payload type.
- The second parameter type is always the full `TInfrastructure` (no merging with `CQRSInfrastructure`).
- The return type is exactly `void | Promise<void>` -- no other return types are allowed.

## Edge Cases

- **Event with `any` payload**: The handler's first parameter becomes `any`.
- **Empty infrastructure (`{}`)**: Valid since `Infrastructure` is `{}`.
- **Synchronous handler**: Returning `void` (no `async`) is valid.
- **Handler that ignores parameters**: A no-op `() => {}` is structurally compatible.

## Integration Points

- `EventHandler` is used in projection-like patterns where events trigger side effects outside of aggregate state transitions.
- It differs from `ApplyHandler` (pure, no infrastructure) and from `SagaEventHandler` (receives full event, returns commands).

## Test Scenarios

### EventHandler receives payload and infrastructure

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventHandler, DefineEvents, Infrastructure } from "@noddde/core";

describe("EventHandler", () => {
  type OrderEvent = DefineEvents<{
    OrderPlaced: { orderId: string; total: number };
  }>;
  type OrderPlacedEvent = Extract<OrderEvent, { name: "OrderPlaced" }>;

  interface MyInfrastructure extends Infrastructure {
    emailService: { send(to: string, body: string): Promise<void> };
  }

  type Handler = EventHandler<OrderPlacedEvent, MyInfrastructure>;

  it("should accept payload as first parameter", () => {
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<{
      orderId: string;
      total: number;
    }>();
  });

  it("should accept infrastructure as second parameter", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<MyInfrastructure>();
  });

  it("should return void or Promise<void>", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<void | Promise<void>>();
  });
});
```

### EventHandler allows sync and async implementations

```ts
import { describe, it, expect } from "vitest";
import type { EventHandler, Event, Infrastructure } from "@noddde/core";

describe("EventHandler sync/async", () => {
  it("should allow synchronous handler", () => {
    const handler: EventHandler<Event, Infrastructure> = (_payload, _infra) => {
      // no-op, sync
    };
    expect(handler).toBeDefined();
  });

  it("should allow asynchronous handler", () => {
    const handler: EventHandler<Event, Infrastructure> = async (_payload, _infra) => {
      // no-op, async
    };
    expect(handler).toBeDefined();
  });
});
```
