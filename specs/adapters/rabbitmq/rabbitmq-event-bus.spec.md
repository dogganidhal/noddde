---
title: "RabbitMqEventBus"
module: adapters/rabbitmq/rabbitmq-event-bus
source_file: packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts
status: ready
exports: [RabbitMqEventBus, RabbitMqEventBusConfig]
depends_on:
  - core/edd/event-bus
  - core/edd/event
  - core/infrastructure/closeable
  - core/infrastructure/connectable
  - core/infrastructure/broker-resilience
docs: []
---

# RabbitMqEventBus

> RabbitMQ-backed EventBus implementation using `amqplib`. Publishes domain events to a RabbitMQ exchange and delivers them to registered handlers via bound queues. Provides at-least-once delivery with manual acknowledgment. Suitable for distributed deployments where reliable message brokering with flexible routing is required.

## Type Contract

```ts
import type {
  EventBus,
  AsyncEventHandler,
  Connectable,
  BrokerResilience,
} from "@noddde/core";

/** Configuration for the RabbitMqEventBus. */
export interface RabbitMqEventBusConfig {
  /** RabbitMQ connection URL (e.g., "amqp://localhost:5672"). */
  url: string;
  /** Exchange name for event publishing (default: "noddde.events"). */
  exchangeName?: string;
  /** Exchange type: "topic" (default) or "fanout". Topic uses event name as routing key. */
  exchangeType?: "topic" | "fanout";
  /** Queue name prefix for consumer queues (default: "noddde"). Queues are named "${queuePrefix}.${eventName}". */
  queuePrefix?: string;
  /** Number of unacknowledged messages the broker may send to this consumer (default: 10). Provides backpressure control via channel.prefetch(). */
  prefetchCount?: number;
  /** Connection resilience configuration (default: maxAttempts=3, initialDelayMs=1000, maxDelayMs=30000). amqplib has no built-in reconnection — retry is implemented manually with exponential backoff. */
  resilience?: BrokerResilience;
}

export class RabbitMqEventBus implements EventBus, Connectable {
  constructor(config: RabbitMqEventBusConfig);

  /** Establishes a connection and channel to RabbitMQ. Asserts the exchange. Must be called before dispatch or on. */
  connect(): Promise<void>;

  /** Registers a handler for a given event name. Binds a queue to the exchange with the event name as routing key. */
  on(eventName: string, handler: AsyncEventHandler): void;

  /** Publishes an event to the RabbitMQ exchange with the event name as routing key. */
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;

  /** Closes the channel and connection, clears handlers. Idempotent. */
  close(): Promise<void>;
}
```

## Behavioral Requirements

### Dispatch

1. **Exchange routing** -- `dispatch(event)` publishes to the configured exchange with `event.name` as the routing key (for topic exchanges). For fanout exchanges, the routing key is ignored.
2. **JSON serialization** -- The full event object (`{ name, payload, metadata? }`) is serialized as JSON in the message body (Buffer).
3. **Persistent messages** -- Messages are published with `{ persistent: true }` (delivery mode 2) so they survive broker restarts.
   3b. **Publisher confirms** -- After publishing, `dispatch()` awaits `channel.waitForConfirms()` to ensure the broker has accepted the message. This guarantees at-least-once delivery on the publish side. Without publisher confirms, `channel.publish()` is fire-and-forget and messages can be silently dropped.
4. **Dispatch before connect throws** -- Calling `dispatch` before `connect()` throws an error.

### Subscription / Handler Registration

5. **on registers handlers by event name** -- `on(eventName, handler)` stores the handler in an internal registry keyed by event name. Multiple handlers per event name are supported (fan-out within the same process).
6. **Queue binding** -- When subscriptions are activated (after `connect()`), a durable queue named `${queuePrefix}.${eventName}` is asserted and bound to the exchange with `eventName` as the routing key.
7. **Consumer setup** -- A consumer is started on the queue. Incoming messages are deserialized from JSON and passed to all registered handlers.
   7b. **Message deserialization with poison message protection** -- Deserialization is wrapped in try/catch. If `JSON.parse` throws (malformed message), the error is logged and the message is acknowledged (skipped). Poison messages must never block the queue via infinite nack/requeue loops.
8. **Parallel handler invocation** -- Handlers for the same event are invoked concurrently via `Promise.all()`. If any handler rejects, the message is nacked for redelivery. Handlers that already completed will re-execute on redelivery — consumers must be idempotent. This differs from `EventEmitterEventBus` (which invokes sequentially) because broker adapters operate in distributed contexts where independent handlers should not block each other.
   8b. **maxRetries delivery limit** -- If `resilience.maxRetries` is configured, track delivery attempts using an in-memory `Map<string, number>` keyed by a stable message identifier (e.g., `messageId` from properties, or a hash of the content). On each message receipt, increment the count and check against `maxRetries`. If the count exceeds `maxRetries`, log a warning and ack the message (discard it). This prevents handler-level poison messages from blocking the queue indefinitely via infinite nack/requeue. Note: the in-memory counter resets on consumer restart, which is acceptable since restarted consumers also reset their processing state. The previous `x-death` header approach does not work without a dead-letter exchange configured.
9. **Manual ack after handlers** -- The message is acknowledged (`channel.ack(msg)`) only after all handlers have completed successfully (all promises in the `Promise.all` resolved). All `channel.ack()` and `channel.nack()` calls are wrapped in try/catch — if the channel closed during reconnection, the error is logged but does not crash the consumer callback.

### Backpressure

10. **Prefetch configuration** -- During `connect()`, call `channel.prefetch(prefetchCount)` to limit the number of unacknowledged messages the broker sends to this consumer. Default: 10. This provides natural backpressure when handlers are slow, preventing unbounded message accumulation in process memory.

### Connection Lifecycle

11. **connect establishes connection and channel with retry** -- `connect()` creates an AMQP connection and a **confirm channel** (`connection.createConfirmChannel()`), then asserts the exchange (durable). If `resilience` is configured, connection attempts retry with exponential backoff on failure. Default: 3 attempts, 1000ms initial delay, 30000ms max delay. Delay doubles on each retry (`min(initialDelayMs * 2^attempt, maxDelayMs)`). If all attempts fail, the last error is thrown. Using a confirm channel enables publisher confirms — `dispatch()` awaits `channel.waitForConfirms()` to guarantee the broker received the message.
    11b. **Mid-session reconnection** -- After establishing the connection, register `connection.on('error')` and `connection.on('close')` handlers. On unexpected disconnection (not triggered by `close()`), automatically attempt reconnection using the same `resilience` backoff configuration. During reconnection, `dispatch()` rejects with a connection error. Once reconnected, re-assert the exchange and re-establish consumers for all registered handlers.
12. **connect is idempotent** -- Calling `connect()` when already connected is a no-op.
13. **close closes channel and connection** -- `close()` closes the channel and connection, clears the handler registry. After `close()`, dispatch and on throw.
14. **close is idempotent** -- Calling `close()` multiple times has no additional effect.

### Error Handling

15. **Handler errors cause nack** -- If any handler rejects during parallel invocation, the message is nacked (`channel.nack(msg, false, true)`) for redelivery. The `nack()` call is wrapped in try/catch — if the channel is stale (closed during reconnection), the error is logged.
16. **Serialization errors on dispatch** -- If event serialization fails, `dispatch` rejects with the serialization error.
17. **Connection errors on dispatch** -- If the channel is closed or RabbitMQ is unreachable, `dispatch` rejects with a connection error.

## Invariants

- All dispatched events are serialized as JSON (must be JSON-serializable).
- Handlers registered via `on()` receive the full `Event` object.
- Messages are acknowledged only after successful handler completion; nacked on handler failure.
- The bus does not deduplicate events.
- Exchange is durable (survives broker restarts).
- Queues are durable (survive broker restarts).
- Messages are persistent (survive broker restarts).

## Edge Cases

- **No handler registered for consumed queue**: Message is acknowledged with no processing.
- **Handler throws**: Message is nacked with requeue=true for redelivery.
- **Dispatch with no payload**: Events with `payload: undefined` are serialized as `{"name":"X","payload":null}`.
- **Multiple handlers for same event**: All handlers invoked in parallel via `Promise.all()`. If any handler rejects, the message is nacked for redelivery. Handlers that already completed will re-execute on redelivery.
- **on() called before connect()**: Handlers are buffered; queue bindings and consumers are set up when `connect()` is called.
- **on() called after close()**: Throws an error.
- **Exchange does not exist**: `connect()` asserts (creates) the exchange.
- **Fanout exchange type**: Routing key is ignored; all bound queues receive all messages.

## Integration Points

- Provided via `DomainWiring.buses()` factory. `Domain.init()` auto-calls `connect()` via `Connectable` auto-discovery (no manual connect needed).
- `Domain.init()` calls `bus.on(eventName, handler)` to register projection, saga, and standalone event handlers (after auto-connect).
- `Domain.shutdown()` calls `bus.close()` (via `Closeable` auto-discovery) to disconnect cleanly.

## Test Scenarios

### dispatch publishes event to exchange with correct routing key

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should publish event to exchange with event name as routing key", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockReturnValue(true),
      consume: vi.fn().mockResolvedValue({ consumerTag: "tag" }),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockConnection = {
      createChannel: vi.fn().mockResolvedValue(mockChannel),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = mockConnection;
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "AccountCreated", payload: { id: "acc-1" } });

    expect(mockChannel.publish).toHaveBeenCalledWith(
      "noddde.events",
      "AccountCreated",
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
  });
});
```

### dispatch publishes persistent messages

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should set persistent flag on published messages", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockReturnValue(true),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "TestEvent", payload: {} });

    const publishOptions = mockChannel.publish.mock.calls[0]![3];
    expect(publishOptions.persistent).toBe(true);
  });
});
```

### dispatch throws before connect

```ts
import { describe, it, expect } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should throw when dispatching before connect", async () => {
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });
});
```

### on registers handler and receives events

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should invoke registered handler when event is consumed", async () => {
    const handler = vi.fn();
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

    bus.on("AccountCreated", handler);

    const event = { name: "AccountCreated", payload: { id: "acc-1" } };
    await (bus as any)._handleMessage(
      "AccountCreated",
      Buffer.from(JSON.stringify(event)),
    );

    expect(handler).toHaveBeenCalledWith(event);
  });
});
```

### multiple handlers for same event are invoked in parallel

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should invoke all handlers concurrently via Promise.all", async () => {
    const results: string[] = [];
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

    bus.on("TestEvent", async () => {
      await new Promise((r) => setTimeout(r, 50));
      results.push("slow");
    });
    bus.on("TestEvent", async () => {
      results.push("fast");
    });

    const event = { name: "TestEvent", payload: {} };
    await (bus as any)._handleMessage(
      "TestEvent",
      Buffer.from(JSON.stringify(event)),
    );

    expect(results).toContain("slow");
    expect(results).toContain("fast");
    expect(results).toHaveLength(2);
    expect(results[0]).toBe("fast");
  });
});
```

### parallel handler failure causes nack

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should reject if any handler throws during parallel invocation", async () => {
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

    const successHandler = vi.fn();
    bus.on("TestEvent", successHandler);
    bus.on("TestEvent", async () => {
      throw new Error("handler failed");
    });

    const event = { name: "TestEvent", payload: {} };
    await expect(
      (bus as any)._handleMessage(
        "TestEvent",
        Buffer.from(JSON.stringify(event)),
      ),
    ).rejects.toThrow("handler failed");
  });
});
```

### connect sets prefetch count on channel

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should call channel.prefetch with configured prefetchCount", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockConnection = {
      createChannel: vi.fn().mockResolvedValue(mockChannel),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      prefetchCount: 20,
    });
    (bus as any)._connection = mockConnection;
    (bus as any)._channel = mockChannel;

    // Simulate connect setting prefetch
    await bus.connect();

    expect(mockChannel.prefetch).toHaveBeenCalledWith(20);
  });
});
```

### connect retries with exponential backoff on failure

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should retry connection with exponential backoff", async () => {
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      resilience: {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
      },
    });

    // Config is stored for use during connect()
    expect((bus as any)._config?.resilience?.maxAttempts).toBe(3);
    expect((bus as any)._config?.resilience?.initialDelayMs).toBe(100);
  });
});
```

### close disconnects and clears handlers

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should close channel and connection on close", async () => {
    const mockChannel = { close: vi.fn().mockResolvedValue(undefined) };
    const mockConnection = { close: vi.fn().mockResolvedValue(undefined) };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = mockConnection;
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    bus.on("TestEvent", vi.fn());
    await bus.close();

    expect(mockChannel.close).toHaveBeenCalled();
    expect(mockConnection.close).toHaveBeenCalled();

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow();
  });
});
```

### close is idempotent

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should not throw when close is called multiple times", async () => {
    const mockChannel = { close: vi.fn().mockResolvedValue(undefined) };
    const mockConnection = { close: vi.fn().mockResolvedValue(undefined) };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = mockConnection;
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.close();
    await expect(bus.close()).resolves.toBeUndefined();
  });
});
```

### handler error causes nack for redelivery

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should nack message when handler throws", async () => {
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

    bus.on("FailEvent", async () => {
      throw new Error("handler failed");
    });

    const event = { name: "FailEvent", payload: {} };
    await expect(
      (bus as any)._handleMessage(
        "FailEvent",
        Buffer.from(JSON.stringify(event)),
      ),
    ).rejects.toThrow("handler failed");
  });
});
```

### dispatch serializes full event as JSON

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should serialize the full event object including metadata", async () => {
    const mockChannel = {
      publish: vi.fn().mockReturnValue(true),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    const event = {
      name: "AccountCreated",
      payload: { id: "acc-1" },
      metadata: { eventId: "evt-1", correlationId: "corr-1" },
    };
    await bus.dispatch(event);

    const sentBuffer = mockChannel.publish.mock.calls[0]![2];
    const parsed = JSON.parse(sentBuffer.toString());
    expect(parsed).toEqual(event);
  });
});
```
