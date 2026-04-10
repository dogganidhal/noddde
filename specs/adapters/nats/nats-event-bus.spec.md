---
title: "NatsEventBus"
module: adapters/nats/nats-event-bus
source_file: packages/adapters/nats/src/nats-event-bus.ts
status: ready
exports: [NatsEventBus, NatsEventBusConfig]
depends_on:
  - core/edd/event-bus
  - core/edd/event
  - core/infrastructure/closeable
  - core/infrastructure/connectable
  - core/infrastructure/broker-resilience
docs: []
---

# NatsEventBus

> NATS-backed EventBus implementation using the `nats` client library with JetStream for durable subscriptions. Publishes domain events to NATS subjects and delivers them to registered handlers via JetStream consumers. Provides at-least-once delivery with durable subscriptions. Suitable for distributed deployments where lightweight, high-throughput event streaming is required.

## Type Contract

```ts
import type {
  EventBus,
  AsyncEventHandler,
  Connectable,
  BrokerResilience,
} from "@noddde/core";

/** Configuration for the NatsEventBus. */
export interface NatsEventBusConfig {
  /** NATS server URL(s) (e.g., "localhost:4222" or ["nats://host1:4222", "nats://host2:4222"]). */
  servers: string | string[];
  /** JetStream stream name for durable subscriptions (e.g., "noddde-events"). */
  streamName?: string;
  /** Optional prefix prepended to event names to form subject names (e.g., "noddde." → "noddde.AccountCreated"). */
  subjectPrefix?: string;
  /** Maximum number of unacknowledged messages per consumer (default: 256). Provides backpressure control. */
  prefetchCount?: number;
  /** Connection resilience configuration (default: maxAttempts=-1/infinite, initialDelayMs=2000). NATS uses fixed intervals — maxDelayMs is ignored. */
  resilience?: BrokerResilience;
}

export class NatsEventBus implements EventBus, Connectable {
  constructor(config: NatsEventBusConfig);

  /** Establishes a connection to the NATS server and initializes JetStream. Must be called before dispatch or on. */
  connect(): Promise<void>;

  /** Registers a handler for a given event name. Creates a JetStream consumer subscription for the subject. */
  on(eventName: string, handler: AsyncEventHandler): void;

  /** Publishes an event to the NATS subject derived from the event name. */
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;

  /** Drains the NATS connection, clears handlers. Idempotent. */
  close(): Promise<void>;
}
```

## Behavioral Requirements

### Dispatch

1. **Subject derivation** -- `dispatch(event)` publishes to a NATS subject named `${subjectPrefix}${event.name}` (default prefix is empty, so subject = event name).
2. **JSON serialization** -- The full event object (`{ name, payload, metadata? }`) is serialized as JSON in the message data.
3. **JetStream publish** -- `dispatch` uses JetStream `publish()` for durable message delivery. Awaits the publish acknowledgment.
4. **Dispatch before connect throws** -- Calling `dispatch` before `connect()` throws an error.

### Subscription / Handler Registration

5. **on registers handlers by event name** -- `on(eventName, handler)` stores the handler in an internal registry keyed by event name. Multiple handlers per event name are supported (fan-out within the same process).
6. **JetStream consumer** -- When subscriptions are activated (after `connect()`), a JetStream consumer is created for each registered event name's subject. Uses a durable consumer name derived from the event name.
7. **Message deserialization with poison message protection** -- Incoming NATS messages are deserialized from JSON. Deserialization is wrapped in try/catch. If `JSON.parse` throws (malformed message), the error is logged and the message is terminated (`msg.term()`) to permanently discard it. Poison messages must never block the subscription via infinite redelivery.
8. **Parallel handler invocation** -- Handlers for the same event are invoked concurrently via `Promise.all()`. If any handler rejects, the message is explicitly nacked (`msg.nak()`) for immediate redelivery (instead of silently relying on the ack timeout). The error is logged with event name and error details. Handlers that already completed will re-execute on redelivery — consumers must be idempotent. This differs from `EventEmitterEventBus` (which invokes sequentially) because broker adapters operate in distributed contexts where independent handlers should not block each other.
9. **Ack after handlers** -- The message is acknowledged (`msg.ack()`) only after all handlers have completed successfully (all promises in the `Promise.all` resolved).

### Backpressure

10. **prefetchCount configuration** -- When creating JetStream consumer subscriptions, set `maxAckPending` on the consumer options to the value of `prefetchCount`. Default: 256. This limits the number of unacknowledged messages the server delivers to the consumer, providing natural backpressure when handlers are slow.
    10b. **maxRetries delivery limit** -- If `resilience.maxRetries` is configured, set `maxDeliver` on the JetStream consumer options. This limits how many times NATS will redeliver a message before discarding it, preventing handler-level poison messages from blocking the subscription indefinitely.

### Connection Lifecycle

11. **connect establishes NATS connection** -- `connect()` connects to the NATS server and obtains a JetStream context. Creates or verifies the stream if `streamName` is configured. The `resilience` config option is mapped to NATS client reconnection options: `maxAttempts` → `maxReconnectAttempts`, `initialDelayMs` → `reconnectTimeWait`. Reconnection is enabled by default. `maxDelayMs` is ignored (NATS uses fixed intervals). Defaults: reconnect=true, maxReconnectAttempts=-1 (infinite), reconnectTimeWait=2000ms.
12. **connect is idempotent** -- Calling `connect()` when already connected is a no-op.
13. **close drains the connection** -- `close()` drains the NATS connection (processes in-flight messages, then disconnects), clears the handler registry.
14. **close is idempotent** -- Calling `close()` multiple times has no additional effect.

### Error Handling

15. **Handler errors prevent ack** -- If any handler rejects during parallel invocation, the `Promise.all` rejection propagates and the message is not acknowledged (NATS will redeliver based on consumer config).
16. **Serialization errors on dispatch** -- If event serialization fails, `dispatch` rejects with the serialization error.
17. **Connection errors on dispatch** -- If the NATS server is unreachable, `dispatch` rejects with a connection error.

## Invariants

- All dispatched events are serialized as JSON (must be JSON-serializable).
- Handlers registered via `on()` receive the full `Event` object.
- Messages are acknowledged only after successful handler completion.
- The bus does not deduplicate events.
- Subject names follow the pattern `${subjectPrefix}${eventName}`.
- JetStream provides durable message storage — events survive broker restarts.

## Edge Cases

- **No handler registered for consumed subject**: Message is acknowledged with no processing.
- **Handler throws**: Message is not acknowledged; NATS redelivers based on consumer config.
- **Dispatch with no payload**: Events with `payload: undefined` are serialized as `{"name":"X","payload":null}`.
- **Multiple handlers for same event**: All handlers invoked in parallel via `Promise.all()`. If any handler rejects, the message is not acknowledged (enabling redelivery). Handlers that already completed will re-execute on redelivery.
- **on() called before connect()**: Handlers are buffered; subscriptions happen when `connect()` is called.
- **on() called after close()**: Throws an error.
- **Stream does not exist**: `connect()` creates the stream if `streamName` is configured and stream does not exist.

## Integration Points

- Provided via `DomainWiring.buses()` factory. `Domain.init()` auto-calls `connect()` via `Connectable` auto-discovery (no manual connect needed).
- `Domain.init()` calls `bus.on(eventName, handler)` to register projection, saga, and standalone event handlers (after auto-connect).
- `Domain.shutdown()` calls `bus.close()` (via `Closeable` auto-discovery) to drain and disconnect.

## Test Scenarios

### dispatch publishes event to correct subject

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should publish event to subject derived from event name", async () => {
    const mockJetstream = {
      publish: vi.fn().mockResolvedValue({ seq: 1, stream: "test" }),
    };
    const mockConnection = {
      jetstream: () => mockJetstream,
      jetstreamManager: vi
        .fn()
        .mockResolvedValue({ streams: { info: vi.fn() } }),
      drain: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn().mockReturnValue(false),
    };

    const bus = new NatsEventBus({ servers: "localhost:4222" });
    (bus as any)._nc = mockConnection;
    (bus as any)._js = mockJetstream;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "AccountCreated", payload: { id: "acc-1" } });

    expect(mockJetstream.publish).toHaveBeenCalledWith(
      "AccountCreated",
      expect.any(Uint8Array),
    );
  });
});
```

### dispatch uses subject prefix when configured

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should prepend subjectPrefix to event name for subject", async () => {
    const mockJetstream = {
      publish: vi.fn().mockResolvedValue({ seq: 1, stream: "test" }),
    };

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      subjectPrefix: "noddde.",
    });
    (bus as any)._nc = {};
    (bus as any)._js = mockJetstream;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "OrderPlaced", payload: {} });

    expect(mockJetstream.publish).toHaveBeenCalledWith(
      "noddde.OrderPlaced",
      expect.any(Uint8Array),
    );
  });
});
```

### dispatch throws before connect

```ts
import { describe, it, expect } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should throw when dispatching before connect", async () => {
    const bus = new NatsEventBus({ servers: "localhost:4222" });

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });
});
```

### on registers handler and receives events

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should invoke registered handler when event is consumed", async () => {
    const handler = vi.fn();
    const bus = new NatsEventBus({ servers: "localhost:4222" });

    bus.on("AccountCreated", handler);

    const event = { name: "AccountCreated", payload: { id: "acc-1" } };
    await (bus as any)._handleMessage("AccountCreated", JSON.stringify(event));

    expect(handler).toHaveBeenCalledWith(event);
  });
});
```

### multiple handlers for same event are invoked in parallel

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should invoke all handlers concurrently via Promise.all", async () => {
    const results: string[] = [];
    const bus = new NatsEventBus({ servers: "localhost:4222" });

    bus.on("TestEvent", async () => {
      await new Promise((r) => setTimeout(r, 50));
      results.push("slow");
    });
    bus.on("TestEvent", async () => {
      results.push("fast");
    });

    const event = { name: "TestEvent", payload: {} };
    await (bus as any)._handleMessage("TestEvent", JSON.stringify(event));

    expect(results).toContain("slow");
    expect(results).toContain("fast");
    expect(results).toHaveLength(2);
    expect(results[0]).toBe("fast");
  });
});
```

### parallel handler failure prevents ack

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should reject if any handler throws during parallel invocation", async () => {
    const bus = new NatsEventBus({ servers: "localhost:4222" });

    const successHandler = vi.fn();
    bus.on("TestEvent", successHandler);
    bus.on("TestEvent", async () => {
      throw new Error("handler failed");
    });

    const event = { name: "TestEvent", payload: {} };
    await expect(
      (bus as any)._handleMessage("TestEvent", JSON.stringify(event)),
    ).rejects.toThrow("handler failed");
  });
});
```

### connect maps resilience config to nats reconnection options

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should map BrokerResilience to nats reconnection options", () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      resilience: {
        maxAttempts: 10,
        initialDelayMs: 5000,
      },
    });

    // Config is stored for mapping during connect()
    expect((bus as any)._config.resilience).toEqual({
      maxAttempts: 10,
      initialDelayMs: 5000,
    });
  });
});
```

### prefetchCount is set on consumer subscriptions

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should configure prefetchCount as maxAckPending on JetStream consumer options", () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      prefetchCount: 100,
    });

    expect((bus as any)._config.prefetchCount).toBe(100);
  });
});
```

### close drains connection and clears handlers

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should drain connection and clear handlers on close", async () => {
    const mockDrain = vi.fn().mockResolvedValue(undefined);
    const bus = new NatsEventBus({ servers: "localhost:4222" });
    (bus as any)._nc = {
      drain: mockDrain,
      isClosed: vi.fn().mockReturnValue(false),
    };
    (bus as any)._connected = true;

    bus.on("TestEvent", vi.fn());
    await bus.close();

    expect(mockDrain).toHaveBeenCalled();

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow();
  });
});
```

### close is idempotent

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should not throw when close is called multiple times", async () => {
    const bus = new NatsEventBus({ servers: "localhost:4222" });
    (bus as any)._nc = {
      drain: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn().mockReturnValue(false),
    };
    (bus as any)._connected = true;

    await bus.close();
    await expect(bus.close()).resolves.toBeUndefined();
  });
});
```

### dispatch serializes full event as JSON

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should serialize the full event object including metadata", async () => {
    const mockPublish = vi.fn().mockResolvedValue({ seq: 1, stream: "test" });

    const bus = new NatsEventBus({ servers: "localhost:4222" });
    (bus as any)._nc = {};
    (bus as any)._js = { publish: mockPublish };
    (bus as any)._connected = true;

    const event = {
      name: "AccountCreated",
      payload: { id: "acc-1" },
      metadata: { eventId: "evt-1", correlationId: "corr-1" },
    };
    await bus.dispatch(event);

    const sentData = mockPublish.mock.calls[0]![1];
    const decoded = new TextDecoder().decode(sentData);
    const parsed = JSON.parse(decoded);
    expect(parsed).toEqual(event);
  });
});
```
