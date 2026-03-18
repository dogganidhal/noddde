---
title: "EventEmitterEventBus"
module: engine/implementations/ee-event-bus
source_file: packages/core/src/engine/implementations/ee-event-bus.ts
status: implemented
exports: [EventEmitterEventBus]
depends_on: [edd/event-bus, edd/event]
docs:
  - infrastructure/in-memory-implementations.mdx
---

# EventEmitterEventBus

> In-memory EventBus implementation backed by Node.js `EventEmitter`. Dispatches domain events synchronously within the same process by emitting on the event's `name` channel with its `payload`. Suitable for development, testing, and single-process deployments.

## Type Contract

```ts
class EventEmitterEventBus implements EventBus {
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;
}
```

- Implements the `EventBus` interface from `edd/event-bus`.
- `dispatch` is async (returns `Promise<void>`) even though the underlying `EventEmitter.emit` is synchronous. This keeps the interface uniform with async bus implementations (e.g., Kafka, RabbitMQ).
- The generic `TEvent extends Event` preserves event type narrowing at call sites, but the runtime behavior is untyped (emitter channels are `string`-keyed).

## Behavioral Requirements

1. **Channel routing** -- `dispatch({ name, payload })` calls `this.underlying.emit(name, payload)`. The event's `name` is used as the EventEmitter channel name.
2. **Payload forwarding** -- Listeners receive the raw `payload` as the first argument, not the full event envelope. This is a deliberate design choice: projection reducers and event handlers operate on `event.payload`, not the envelope.
3. **Fire-and-forget** -- `dispatch` resolves immediately after `emit` returns. It does not await any listener callbacks (even if they are async). Listener errors do not propagate to the dispatcher.
4. **Multiple listeners** -- Multiple listeners on the same channel all receive the payload, in registration order (standard EventEmitter semantics).
5. **No listeners** -- If no listener is registered for the event name, `emit` is a no-op and `dispatch` still resolves successfully.
6. **Internal emitter** -- The `EventEmitter` instance is private and created once in the constructor (via field initializer). It is not exposed to consumers.

## Invariants

- `dispatch` never throws (it always resolves). The EventEmitter may throw if a listener throws synchronously, but this should be considered a bug in the listener, not the bus.
- The bus does not store or replay events. It is a pure pub/sub channel.
- The bus does not deduplicate events. Dispatching the same event object twice results in two emissions.

## Edge Cases

- **Empty payload** -- `dispatch({ name: "SomeEvent", payload: undefined })` emits on channel `"SomeEvent"` with `undefined` as the argument. Listeners must tolerate this.
- **Payload mutation** -- The bus does not clone the payload. If a listener mutates the payload object, other listeners (and the caller) see the mutation. This is acceptable for in-memory use but would be a bug source in production; document as a known trade-off.
- **High listener count** -- Node.js EventEmitter warns at 11+ listeners per channel by default. The bus does not override `setMaxListeners`. Large domains may need to call `setMaxListeners` on the underlying emitter (currently not possible without exposing it).
- **Async listeners** -- If a listener is async and throws, the rejection becomes an unhandled promise rejection (Node.js default behavior). The bus does not catch it.

## Integration Points

- **Domain.init()** -- The domain engine registers projection reducers and saga event handlers as listeners on the underlying EventEmitter via this bus.
- **Domain.dispatchCommand()** -- After persisting aggregate events, the domain dispatches each event through this bus, triggering projections and sagas.
- **CQRSInfrastructure** -- This bus is provided as `eventBus` in the merged infrastructure object.

## Test Scenarios

### dispatch emits event payload on the correct channel

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/core";

describe("EventEmitterEventBus", () => {
  it("should emit event payload on the event name channel", async () => {
    const bus = new EventEmitterEventBus();
    const listener = vi.fn();

    // Access underlying emitter for test verification
    // @ts-expect-error -- accessing private field for testing
    bus.underlying.on("AccountCreated", listener);

    const event = {
      name: "AccountCreated" as const,
      payload: { id: "acc-1", owner: "Alice" },
    };

    await bus.dispatch(event);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ id: "acc-1", owner: "Alice" });
  });
});
```

### dispatch resolves when no listeners are registered

```ts
import { describe, it, expect } from "vitest";
import { EventEmitterEventBus } from "@noddde/core";

describe("EventEmitterEventBus", () => {
  it("should resolve successfully even with no listeners", async () => {
    const bus = new EventEmitterEventBus();

    await expect(
      bus.dispatch({ name: "UnhandledEvent", payload: {} }),
    ).resolves.toBeUndefined();
  });
});
```

### multiple listeners all receive the payload

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/core";

describe("EventEmitterEventBus", () => {
  it("should notify all listeners registered on the same channel", async () => {
    const bus = new EventEmitterEventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    // @ts-expect-error -- accessing private field for testing
    bus.underlying.on("DepositMade", listener1);
    // @ts-expect-error -- accessing private field for testing
    bus.underlying.on("DepositMade", listener2);

    await bus.dispatch({
      name: "DepositMade",
      payload: { amount: 100 },
    });

    expect(listener1).toHaveBeenCalledWith({ amount: 100 });
    expect(listener2).toHaveBeenCalledWith({ amount: 100 });
  });
});
```

### dispatching the same event twice emits twice

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/core";

describe("EventEmitterEventBus", () => {
  it("should emit each dispatch independently without deduplication", async () => {
    const bus = new EventEmitterEventBus();
    const listener = vi.fn();

    // @ts-expect-error -- accessing private field for testing
    bus.underlying.on("ItemAdded", listener);

    const event = { name: "ItemAdded", payload: { itemId: "x" } };

    await bus.dispatch(event);
    await bus.dispatch(event);

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
```

### events on different channels do not interfere

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/core";

describe("EventEmitterEventBus", () => {
  it("should only notify listeners on the matching event name channel", async () => {
    const bus = new EventEmitterEventBus();
    const accountListener = vi.fn();
    const orderListener = vi.fn();

    // @ts-expect-error -- accessing private field for testing
    bus.underlying.on("AccountCreated", accountListener);
    // @ts-expect-error -- accessing private field for testing
    bus.underlying.on("OrderPlaced", orderListener);

    await bus.dispatch({
      name: "AccountCreated",
      payload: { id: "acc-1" },
    });

    expect(accountListener).toHaveBeenCalledOnce();
    expect(orderListener).not.toHaveBeenCalled();
  });
});
```
