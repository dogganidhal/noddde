---
title: "EventBus"
module: edd/event-bus
source_file: packages/core/src/edd/event-bus.ts
status: ready
exports: [EventBus, AsyncEventHandler, LateSubscriptionError]
depends_on: [edd/event, infrastructure/closeable]
docs:
  - events/event-bus.mdx
---

# EventBus

> The `EventBus` interface defines the contract for publishing and subscribing to domain events. It is the backbone of the read-side update mechanism in CQRS, responsible for routing events to projections, event handlers, and sagas. Extends `Closeable` for lifecycle management — implementations hold resources (connections, subscriptions) that must be released on shutdown.

## Type Contract

```ts
import type { Closeable } from "../infrastructure/closeable";
import type { Event } from "./event";

/** Async-capable event handler that receives the full event object. */
export type AsyncEventHandler = (event: Event) => void | Promise<void>;

/**
 * Publishes domain events to all registered listeners (projections, event handlers, sagas).
 * Extends Closeable so implementations can release connections and subscriptions on shutdown.
 */
export interface EventBus extends Closeable {
  /** Publishes a single domain event to all subscribers. */
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;
  /**
   * Registers an async-capable handler for a given event name. Multiple
   * handlers per name (fan-out). See late-registration contract below.
   */
  on(eventName: string, handler: AsyncEventHandler): void;
}

/**
 * Thrown by `on()` implementations when a handler is registered for an
 * event name that was not already registered before the bus connected.
 */
export class LateSubscriptionError extends Error {
  readonly name: "LateSubscriptionError";
  readonly eventName: string;
  constructor(eventName: string);
}
```

- **`EventBus`** extends `Closeable`, inheriting `close(): Promise<void>`.
- **`dispatch`** is generic over `TEvent`, preserving the concrete event type at the call site. Returns `Promise<void>`.
- **`on`** registers a handler for a specific event name. Multiple handlers per name are supported (fan-out pattern). Handlers receive the full `Event` object (name, payload, metadata), not just the payload.
- **`AsyncEventHandler`** is a named type for event handler functions. Exported from `@noddde/core` so implementations and consumers can reference it.
- **`close`** (inherited from `Closeable`) releases all resources: clears registered handlers and disconnects from any underlying transport. Must be idempotent.

## Behavioral Requirements

1. **dispatch accepts any Event subtype** -- `dispatch` accepts any value satisfying the `Event` interface (structural typing). The generic `TEvent` enables implementations to access the narrowed type.
2. **dispatch returns Promise<void>** -- Callers must `await` or handle the promise. Implementations may be synchronous internally but must return `Promise<void>`.
3. **on registers handlers by event name** -- Multiple calls to `on` with the same event name accumulate handlers (fan-out). Each handler is invoked independently when a matching event is dispatched.
4. **Handlers receive full Event object** -- Handlers receive `{ name, payload, metadata? }`, not just the payload. This allows access to metadata for correlation, tracing, and sequencing.
5. **close releases all resources** -- `close()` clears registered handlers and releases any underlying connections (transport, sockets, etc.). After `close()`, dispatching or registering handlers may throw.
6. **close is idempotent** -- Calling `close()` multiple times has no additional effect after the first call (inherited from `Closeable`).
7. **Per-handler error isolation is mandatory** -- Implementations MUST run all registered handlers for a single event delivery to completion, regardless of individual handler failures. A handler that throws or returns a rejected promise MUST NOT short-circuit invocation of its siblings. This requirement is non-negotiable for every `EventBus` implementation (in-memory, broker-backed, future transports).
8. **Each handler failure MUST be individually observable** -- Implementations MUST log every individual handler failure at `error` level via the framework `Logger`, with at least the fields `eventName`, `handlerName` (best-effort from `handler.name`), and the error itself. When an active OpenTelemetry span is available, log entries SHOULD include `traceId` and `spanId` for log↔trace correlation.
9. **Late-registration contract** -- For a `Connectable` (broker-backed) implementation, registering the _first_ handler for an event name that was not already registered before `connect()` was called MUST throw `LateSubscriptionError`. This is the one contract every broker implementation can honor (a broker consumer subscribes to a fixed topic/subject/queue set at connect time). Registering an _additional_ handler for an event name that was already registered pre-connect is ordinary fan-out and MUST NOT throw. In-memory / non-`Connectable` implementations have no connect phase, so this contract does not restrict them — every `on()` call is trivially "pre-connect."

## Invariants

- Any object implementing `EventBus` must have `dispatch`, `on`, and `close` methods.
- `dispatch` always returns `Promise<void>` regardless of event type.
- `on` supports multiple handlers per event name (fan-out).
- Per-handler isolation is mandatory; implementations may choose how aggregate handler failure interacts with their transport-level ack/retry/DLQ (e.g. message redelivery, offset commits, nack policies) — but in-process fan-out of siblings is non-negotiable.
- After `close()`, the bus should not deliver events to handlers.
- Every broker-backed implementation of `EventBus` shares one late-`on()` contract (throw `LateSubscriptionError` for a genuinely new event name after connect); no adapter may substitute a different behavior (silent accept, fire-and-forget) for that case. See `specs/api-freeze.spec.md` decision 6.

## Edge Cases

- **Dispatch with a plain `Event`**: Should compile, since `Event` extends itself.
- **Dispatch with a narrowed event type**: The generic preserves the literal `name` and typed `payload`.
- **Void return**: Implementations that are synchronous internally still must return a `Promise<void>`.
- **on after close**: Behavior is implementation-defined (may throw or silently ignore).
- **dispatch after close**: Behavior is implementation-defined (may throw or silently ignore).
- **In-process handler failure**: In-memory implementations whose `dispatch` awaits handlers MUST NOT reject due to handler failure — `dispatch` resolves successfully even if all handlers failed. Broker-backed implementations whose `dispatch` is a publish call (handler invocation happens later in a consumer loop) MUST still complete all in-process sibling handlers per delivery, regardless of failures; the transport-level ack/retry/DLQ policy is implementation-defined.

## Integration Points

- `EventBus` is a member of `CQRSInfrastructure`, making it available to standalone command handlers and saga event handlers.
- The engine/runtime uses `EventBus.dispatch()` to publish events after aggregate command handling.
- The engine/runtime uses `EventBus.on()` to register projection reducers, saga handlers, and standalone event handlers during `Domain.init()`.
- `Domain.shutdown()` calls `EventBus.close()` to release resources.

## Migration

This is a **breaking change** from the previous version:

| Aspect            | Before                                         | After                                    |
| ----------------- | ---------------------------------------------- | ---------------------------------------- |
| Subscription      | Not on interface (`EventEmitterEventBus.on()`) | `EventBus.on()` — first-class            |
| Lifecycle         | No lifecycle on interface                      | `extends Closeable` — `close()` required |
| AsyncEventHandler | Local to `ee-event-bus.ts`                     | Exported from `@noddde/core`             |
| Domain coupling   | Casts `eventBus as EventEmitterEventBus`       | Uses `EventBus` interface directly       |

**Migration steps for custom EventBus implementations:**

1. Add `on(eventName: string, handler: AsyncEventHandler): void` method.
2. Add `close(): Promise<void>` method (idempotent, clears handlers + releases resources).
3. Import `AsyncEventHandler` from `@noddde/core` instead of defining locally.

## Test Scenarios

### EventBus dispatch accepts any Event subtype

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventBus, Event, DefineEvents } from "@noddde/core";

describe("EventBus", () => {
  it("should accept a base Event", () => {
    const bus = {} as EventBus;
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

### EventBus has on method for handler registration

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventBus, AsyncEventHandler } from "@noddde/core";

describe("EventBus", () => {
  it("should have an on method that accepts eventName and handler", () => {
    const bus = {} as EventBus;
    expectTypeOf(bus.on).toBeFunction();
    expectTypeOf(bus.on).parameters.toEqualTypeOf<
      [string, AsyncEventHandler]
    >();
    expectTypeOf(bus.on).returns.toEqualTypeOf<void>();
  });
});
```

### EventBus extends Closeable

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventBus, Closeable } from "@noddde/core";

describe("EventBus", () => {
  it("should extend Closeable and have a close method", () => {
    const bus = {} as EventBus;
    expectTypeOf(bus).toMatchTypeOf<Closeable>();
    expectTypeOf(bus.close).toBeFunction();
    expectTypeOf(bus.close()).toEqualTypeOf<Promise<void>>();
  });
});
```

### AsyncEventHandler type matches expected signature

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { AsyncEventHandler, Event } from "@noddde/core";

describe("AsyncEventHandler", () => {
  it("should accept an Event and return void or Promise<void>", () => {
    const syncHandler: AsyncEventHandler = (_event: Event) => {};
    const asyncHandler: AsyncEventHandler = async (_event: Event) => {};
    expectTypeOf(syncHandler).toMatchTypeOf<AsyncEventHandler>();
    expectTypeOf(asyncHandler).toMatchTypeOf<AsyncEventHandler>();
  });
});
```

### EventBus can be implemented structurally

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EventBus } from "@noddde/core";

describe("EventBus structural implementation", () => {
  it("should allow any object with matching dispatch, on, and close methods", () => {
    const myBus = {
      dispatch: async () => {},
      on: () => {},
      close: async () => {},
    };
    expectTypeOf(myBus).toMatchTypeOf<EventBus>();
  });
});
```

### LateSubscriptionError: the shared late-on() contract error type

```ts
import { describe, it, expect } from "vitest";
import { LateSubscriptionError } from "@noddde/core";

describe("LateSubscriptionError", () => {
  it("should have correct name, message, and eventName property", () => {
    const error = new LateSubscriptionError("NewEvent");
    expect(error.name).toBe("LateSubscriptionError");
    expect(error.eventName).toBe("NewEvent");
    expect(error.message).toContain("NewEvent");
  });

  it("should be an instance of Error", () => {
    const error = new LateSubscriptionError("NewEvent");
    expect(error).toBeInstanceOf(Error);
  });
});
```
