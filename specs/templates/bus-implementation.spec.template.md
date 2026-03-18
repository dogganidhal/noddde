---
title: "[BusName] [BusType] Implementation"
module: engine/implementations/[bus-name]
source_file: packages/[package]/src/[path]/[bus-name].ts
status: draft
exports: [[BusName]]
depends_on: []
  # Choose the relevant dependency:
  # - core/edd/event-bus       (for EventBus implementations)
  # - core/cqrs/command-bus    (for CommandBus implementations)
  # - core/cqrs/query-bus      (for QueryBus implementations)
docs: []  # Documentation pages covering this module (paths relative to packages/docs/content/docs/)
---

# [BusName] [BusType] Implementation

> [1-2 sentence summary of this bus implementation: what transport it uses (in-memory, Kafka, Redis, RabbitMQ, etc.), what guarantees it provides, and when to use it.]

## Type Contract

<!--
  Identify which bus interface this class implements.
  Choose ONE of the following:
-->

### For EventBus implementations:

```ts
import type { EventBus } from "@noddde/core";
// interface EventBus {
//   dispatch<TEvent extends Event>(event: TEvent): Promise<void>;
// }
```

### For CommandBus implementations:

```ts
import type { CommandBus } from "@noddde/core";
// interface CommandBus {
//   dispatch(command: Command): Promise<void>;
// }
```

### For QueryBus implementations:

```ts
import type { QueryBus } from "@noddde/core";
// interface QueryBus {
//   dispatch<TQuery extends Query<any>>(query: TQuery): Promise<QueryResult<TQuery>>;
// }
```

### Implementation Class

```ts
// TODO: Define your implementation class
export class [BusName] implements [BusInterface] {
  constructor(
    // TODO: Define constructor parameters
    // Example for Kafka: config: { brokers: string[]; clientId: string }
    // Example for Redis: config: { url: string }
  ) {}

  // TODO: Implement the interface methods
}
```

## Behavioral Requirements

### Dispatch

<!--
  Describe how messages are dispatched:
  - How is the message serialized and sent to the transport?
  - Is dispatch fire-and-forget or does it wait for acknowledgment?
  - What is the delivery guarantee (at-most-once, at-least-once, exactly-once)?
-->

- [Describe dispatch behavior]

### Subscription / Handler Registration

<!--
  Describe how handlers are registered and how incoming messages are routed:
  - How are handlers registered (by message name, topic, queue, etc.)?
  - How are incoming messages deserialized and routed to the correct handler?
  - What happens if no handler is registered for a message?
  - For QueryBus: how is the result returned to the caller?
-->

- [Describe subscription/registration mechanism]

### Connection Lifecycle

<!--
  Describe how connections to the transport are managed:
  - How is the connection established (constructor, explicit connect(), lazy)?
  - How is the connection closed (explicit disconnect(), dispose pattern)?
  - How are reconnections handled?
-->

- [Describe connection management]

### Error Handling

<!--
  Describe error scenarios:
  - What happens if the transport is unavailable?
  - What happens if a handler throws?
  - What happens if serialization/deserialization fails?
  - Are there retries? Dead-letter queues?
-->

- [Describe error handling strategy]

## Invariants

- [ ] [Invariant 1: e.g., "All dispatched messages are serializable to JSON."]
- [ ] [Invariant 2: e.g., "Handlers registered after a message is dispatched do not receive that message."]
- [ ] [Invariant 3: e.g., "The bus is usable after construction without explicit connect()."]
- [ ] [For QueryBus: "Every dispatched query receives exactly one response."]

## Edge Cases

- **No handler registered for message**: [Throw? Silently drop? Log warning?]
- **Handler throws an error**: [Propagate to caller? Retry? Dead-letter?]
- **Multiple handlers for same message name**: [Supported? All invoked? Only first?]
  - EventBus: Typically all handlers are invoked (fan-out).
  - CommandBus: Typically exactly one handler per command name.
  - QueryBus: Typically exactly one handler per query name.
- **Dispatch after close/disconnect**: [Throw? Reconnect? Queue?]
- **Concurrent dispatches**: [Thread-safe? Ordering guarantees?]
- **Large message payloads**: [Size limits? Compression?]

## Integration Points

- This bus is provided via `DomainConfiguration.infrastructure.cqrsInfrastructure()`.
- EventBus: consumed by projection wiring and saga wiring in `Domain.init()`.
- CommandBus: consumed by `Domain.dispatchCommand()` and saga command dispatch.
- QueryBus: consumed by projection query handlers and direct query dispatch.

## Test Scenarios

### Basic dispatch and handler invocation

```ts
import { describe, it, expect, vi } from "vitest";

describe("[BusName]", () => {
  it("should dispatch a message to a registered handler", async () => {
    const bus = new [BusName](/* constructor args */);

    // TODO: Register a handler
    // const handler = vi.fn();
    // bus.register("[MessageName]", handler);

    // TODO: Dispatch a message
    // await bus.dispatch({ name: "[MessageName]", payload: { /* ... */ } });

    // TODO: Verify handler was called
    // expect(handler).toHaveBeenCalledWith(/* expected args */);
  });
});
```

### Dispatch with no registered handler

```ts
import { describe, it, expect } from "vitest";

describe("[BusName] - no handler", () => {
  it("should [throw/silently ignore] when no handler is registered", async () => {
    const bus = new [BusName](/* constructor args */);

    // TODO: Dispatch a message with no handler registered
    // For throw behavior:
    // await expect(bus.dispatch({ name: "Unknown", payload: {} })).rejects.toThrow();

    // For silent behavior:
    // await expect(bus.dispatch({ name: "Unknown", payload: {} })).resolves.toBeUndefined();
  });
});
```

### Handler error propagation

```ts
import { describe, it, expect } from "vitest";

describe("[BusName] - handler error", () => {
  it("should [propagate/swallow] errors thrown by handlers", async () => {
    const bus = new [BusName](/* constructor args */);

    // TODO: Register a handler that throws
    // bus.register("[MessageName]", () => { throw new Error("handler failed"); });

    // TODO: Dispatch and verify error behavior
    // await expect(bus.dispatch({ name: "[MessageName]", payload: {} })).rejects.toThrow("handler failed");
  });
});
```

### Multiple handlers for same message (EventBus fan-out)

```ts
import { describe, it, expect, vi } from "vitest";

describe("[BusName] - fan-out", () => {
  it("should invoke all registered handlers for the same event", async () => {
    const bus = new [BusName](/* constructor args */);

    // TODO: Register multiple handlers
    // const handler1 = vi.fn();
    // const handler2 = vi.fn();
    // bus.subscribe("[EventName]", handler1);
    // bus.subscribe("[EventName]", handler2);

    // TODO: Dispatch
    // await bus.dispatch({ name: "[EventName]", payload: {} });

    // TODO: Verify both handlers were called
    // expect(handler1).toHaveBeenCalled();
    // expect(handler2).toHaveBeenCalled();
  });
});
```

### QueryBus returns handler result to caller

```ts
import { describe, it, expect } from "vitest";

// Only applicable to QueryBus implementations
describe("[BusName] - query result", () => {
  it("should return the handler result to the dispatch caller", async () => {
    const bus = new [BusName](/* constructor args */);

    // TODO: Register a query handler that returns a value
    // bus.register("GetItem", (payload) => ({ id: payload.id, name: "Widget" }));

    // TODO: Dispatch and verify result
    // const result = await bus.dispatch({ name: "GetItem", payload: { id: "1" } });
    // expect(result).toEqual({ id: "1", name: "Widget" });
  });
});
```

### Connection lifecycle

```ts
import { describe, it, expect } from "vitest";

describe("[BusName] - connection lifecycle", () => {
  it("should [connect/disconnect] cleanly", async () => {
    const bus = new [BusName](/* constructor args */);

    // TODO: Test connection establishment
    // await bus.connect();

    // TODO: Test dispatch works after connect
    // ...

    // TODO: Test clean disconnect
    // await bus.disconnect();
  });
});
```
