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
  - First parameter: `event: TEvent` -- receives the full event object (including `name`, `payload`, and optional `metadata`).
  - Second parameter: `infrastructure: TInfrastructure` -- external dependencies.
  - Return type: `void | Promise<void>` -- may be sync or async; no return value expected.
- `TEvent` is constrained to `extends Event`.
- `TInfrastructure` is constrained to `extends Infrastructure`.

## Behavioral Requirements

- The handler receives the full event object, consistent with projection reducers and saga event handlers.
- The handler may access `event.payload` for the event data and `event.metadata` for audit/tracing information.
- The handler may perform side effects: I/O, external calls, state mutations.
- Returning `void` (synchronous) or `Promise<void>` (asynchronous) are both valid.
- Infrastructure provides access to repositories, services, and other external dependencies.

## Invariants

- The first parameter type is always `TEvent` (the full event type, not `TEvent["payload"]`).
- The second parameter type is always the full `TInfrastructure` (no merging with `CQRSInfrastructure`).
- The return type is exactly `void | Promise<void>` -- no other return types are allowed.

## Edge Cases

- **Event with `any` payload**: The handler's first parameter becomes `Event` with `any` payload.
- **Empty infrastructure (`{}`)**: Valid since `Infrastructure` is `{}`.
- **Synchronous handler**: Returning `void` (no `async`) is valid.
- **Handler that ignores parameters**: A no-op `() => {}` is structurally compatible.
- **Accessing metadata**: `event.metadata?.correlationId` is valid since metadata is optional on Event.

## Migration

**Breaking change from previous version**: The first parameter changed from `TEvent["payload"]` to `TEvent`. This provides consistency with projection reducers and saga event handlers, and gives handlers access to event metadata for audit/tracing.

To migrate existing handlers:

```ts
// Before:
const handler: EventHandler<MyEvent, MyInfra> = (payload, infra) => { ... };

// After:
const handler: EventHandler<MyEvent, MyInfra> = (event, infra) => {
  const payload = event.payload; // access payload via event.payload
  ...
};
```

## Integration Points

- `EventHandler` is used in patterns where events trigger side effects outside of aggregate state transitions.
- It now has the same event parameter shape as `SagaEventHandler` and projection `ReducerMap` handlers (full event, not just payload).
- It differs from `ApplyHandler` which still receives `TEvent["payload"]` (pure, no infrastructure, no metadata access).

## Test Scenarios

### EventHandler receives full event and infrastructure

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

  it("should accept the full event as first parameter", () => {
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<OrderPlacedEvent>();
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
    const handler: EventHandler<Event, Infrastructure> = (_event, _infra) => {
      // no-op, sync
    };
    expect(handler).toBeDefined();
  });

  it("should allow asynchronous handler", () => {
    const handler: EventHandler<Event, Infrastructure> = async (
      _event,
      _infra,
    ) => {
      // no-op, async
    };
    expect(handler).toBeDefined();
  });
});
```
