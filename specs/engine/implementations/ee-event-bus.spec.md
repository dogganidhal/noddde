---
title: "EventEmitterEventBus"
module: engine/implementations/ee-event-bus
source_file: packages/engine/src/implementations/ee-event-bus.ts
status: implemented
exports: [EventEmitterEventBus]
depends_on: [edd/event-bus, edd/event]
docs:
  - infrastructure/in-memory-implementations.mdx
---

# EventEmitterEventBus

> In-memory EventBus implementation backed by Node.js `EventEmitter`. Dispatches domain events within the same process by emitting on the event's `name` channel with the **full event object** (name, payload, and optional metadata). Handlers are awaited sequentially during dispatch. Suitable for development, testing, and single-process deployments.

## Type Contract

```ts
/** Async-capable event handler that receives the full event object. */
type AsyncEventHandler = (event: Event) => void | Promise<void>;

class EventEmitterEventBus implements EventBus {
  /** Registers an async-capable event handler for a given event name. */
  on(eventName: string, handler: AsyncEventHandler): void;
  /** Dispatches an event to all registered handlers and awaits their completion. */
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;
}
```

- Implements the `EventBus` interface from `edd/event-bus`.
- `dispatch` is async (returns `Promise<void>`) and awaits each registered handler sequentially before resolving. This guarantees that projections and sagas have finished processing before the dispatch call completes.
- The `on` method registers handlers in an internal `Map<string, AsyncEventHandler[]>` keyed by event name. This replaces direct `EventEmitter.on` registration for consumer-facing use.
- The `AsyncEventHandler` type takes a full `Event` object (not just the payload). This aligns with projection reducers and saga event handlers, which also receive the full event.
- The generic `TEvent extends Event` on `dispatch` preserves event type narrowing at call sites.

## Behavioral Requirements

1. **Channel routing** -- `dispatch(event)` looks up handlers registered via `on(event.name, handler)`. The event's `name` is used as the routing key.
2. **Full event forwarding** -- Handlers receive the full `Event` object (including `name`, `payload`, and optional `metadata`), not just the payload. This allows handlers to access metadata for correlation, tracing, and sequencing.
3. **Sequential awaiting** -- `dispatch` iterates over registered handlers in registration order and `await`s each one before calling the next. This ensures deterministic ordering and that all handlers complete before `dispatch` resolves.
4. **Multiple handlers** -- Multiple handlers on the same event name all receive the event, in registration order.
5. **No handlers** -- If no handler is registered for the event name, `dispatch` resolves successfully (no-op).
6. **Internal handler registry** -- Handlers are tracked in a private `Map<string, AsyncEventHandler[]>`. The underlying `EventEmitter` instance is retained for backward compatibility but is not used for handler dispatch.

## Invariants

- `dispatch` never throws under normal operation. If a handler throws, the error propagates to the caller (since handlers are awaited).
- The bus does not store or replay events. It is a pure pub/sub channel.
- The bus does not deduplicate events. Dispatching the same event object twice results in two rounds of handler invocations.
- Handlers are always invoked with the full event object, never with a destructured payload.

## Edge Cases

- **Empty payload** -- `dispatch({ name: "SomeEvent", payload: undefined })` invokes handlers with the full event object where `payload` is `undefined`. Handlers must tolerate this.
- **Event with metadata** -- `dispatch({ name: "E", payload: {}, metadata: { eventId: "...", ... } })` forwards the metadata as part of the full event object. Handlers can inspect `event.metadata` for correlation IDs, timestamps, etc.
- **Payload mutation** -- The bus does not clone the event. If a handler mutates the event object, subsequent handlers (and the caller) see the mutation. This is acceptable for in-memory use but would be a bug source in production; documented as a known trade-off.
- **High handler count** -- The internal `Map`-based registry has no limit on handlers per event name.
- **Async handler errors** -- If a handler is async and throws, the error propagates as a rejected promise from `dispatch` (since handlers are awaited). This differs from the previous fire-and-forget behavior.
- **Handler registration after dispatch** -- Handlers registered after a `dispatch` call has started are not invoked for that dispatch (the handler array is read at dispatch time).

## Integration Points

- **Domain.init()** -- The domain engine registers projection reducers and saga event handlers via `bus.on(eventName, handler)`.
- **Domain.dispatchCommand()** -- After persisting aggregate events, the domain dispatches each event through this bus and awaits completion, ensuring projections and sagas are up-to-date before returning.
- **CQRSInfrastructure** -- This bus is provided as `eventBus` in the merged infrastructure object.

## Migration

This is a **breaking change** from the previous version:

| Aspect               | Before                                         | After                                                |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Handler argument     | `payload` only                                 | Full `Event` object (`{ name, payload, metadata? }`) |
| Dispatch semantics   | Fire-and-forget (`emit` + resolve immediately) | Sequential await (each handler is `await`ed)         |
| Handler registration | Direct `EventEmitter.on`                       | `bus.on(eventName, handler)` method                  |
| Error propagation    | Listener errors were unhandled rejections      | Handler errors propagate via `dispatch` rejection    |

**Migration steps for handler consumers:**

1. Update handler signatures from `(payload) => ...` to `(event) => ...`.
2. Replace `payload.field` access with `event.payload.field`.
3. If handlers need metadata (correlation IDs, timestamps), access `event.metadata`.
4. Handlers that were previously registered via the underlying `EventEmitter` must now use `bus.on(eventName, handler)`.
5. Callers of `dispatch` should be aware that it now awaits all handlers; long-running handlers will block the dispatch call.

## Test Scenarios

### dispatch passes full event object to handler

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should pass the full event object to the handler", async () => {
    const bus = new EventEmitterEventBus();
    const handler = vi.fn();

    bus.on("AccountCreated", handler);

    const event = {
      name: "AccountCreated" as const,
      payload: { id: "acc-1", owner: "Alice" },
    };

    await bus.dispatch(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });
});
```

### dispatch resolves when no handlers are registered

```ts
import { describe, it, expect } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should resolve successfully even with no handlers", async () => {
    const bus = new EventEmitterEventBus();

    await expect(
      bus.dispatch({ name: "UnhandledEvent", payload: {} }),
    ).resolves.toBeUndefined();
  });
});
```

### multiple handlers all receive the full event

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should notify all handlers registered on the same event name", async () => {
    const bus = new EventEmitterEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on("DepositMade", handler1);
    bus.on("DepositMade", handler2);

    const event = {
      name: "DepositMade" as const,
      payload: { amount: 100 },
    };

    await bus.dispatch(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
  });
});
```

### dispatching the same event twice invokes handlers twice

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should invoke handlers for each dispatch independently without deduplication", async () => {
    const bus = new EventEmitterEventBus();
    const handler = vi.fn();

    bus.on("ItemAdded", handler);

    const event = { name: "ItemAdded" as const, payload: { itemId: "x" } };

    await bus.dispatch(event);
    await bus.dispatch(event);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
```

### events on different channels do not interfere

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should only notify handlers on the matching event name channel", async () => {
    const bus = new EventEmitterEventBus();
    const accountHandler = vi.fn();
    const orderHandler = vi.fn();

    bus.on("AccountCreated", accountHandler);
    bus.on("OrderPlaced", orderHandler);

    await bus.dispatch({
      name: "AccountCreated" as const,
      payload: { id: "acc-1" },
    });

    expect(accountHandler).toHaveBeenCalledOnce();
    expect(orderHandler).not.toHaveBeenCalled();
  });
});
```

### dispatch awaits async handlers before resolving

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should await async handlers sequentially before resolving", async () => {
    const bus = new EventEmitterEventBus();
    const order: string[] = [];

    bus.on("TestEvent", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("first");
    });
    bus.on("TestEvent", async () => {
      order.push("second");
    });

    await bus.dispatch({ name: "TestEvent" as const, payload: {} });

    expect(order).toEqual(["first", "second"]);
  });
});
```

### handler receives event metadata when present

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("should forward event metadata as part of the full event object", async () => {
    const bus = new EventEmitterEventBus();
    const handler = vi.fn();

    bus.on("AccountCreated", handler);

    const event = {
      name: "AccountCreated" as const,
      payload: { id: "acc-1" },
      metadata: {
        eventId: "evt-001",
        timestamp: "2026-01-01T00:00:00Z",
        correlationId: "corr-1",
        causationId: "cmd-1",
      },
    };

    await bus.dispatch(event);

    expect(handler).toHaveBeenCalledWith(event);
    const receivedEvent = handler.mock.calls[0]![0];
    expect(receivedEvent.metadata).toBeDefined();
    expect(receivedEvent.metadata.correlationId).toBe("corr-1");
  });
});
```
