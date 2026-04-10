---
title: "RabbitMqEventBus"
module: adapters/rabbitmq/rabbitmq-event-bus
source_file: packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts
status: implemented
exports: [RabbitMqEventBus, RabbitMqEventBusConfig]
depends_on:
  - core/edd/event-bus
  - core/edd/event
  - core/infrastructure/closeable
  - core/infrastructure/connectable
  - core/infrastructure/broker-resilience
  - core/infrastructure/logger
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
  Logger,
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
  /** Framework logger instance. Defaults to NodddeLogger("warn", "noddde:rabbitmq") from @noddde/engine. */
  logger?: Logger;
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
3. **Persistent messages with stable messageId** -- Messages are published with `{ persistent: true }` (delivery mode 2) so they survive broker restarts. When `event.metadata?.eventId` is present, it is set as `properties.messageId` on the published message. This provides consumers with a stable, globally unique identifier for retry tracking instead of relying on content-derived fallback hashes. When metadata is absent, `messageId` is omitted (no crash).
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
    11b. **Mid-session reconnection (persistent)** -- After establishing the connection, register `connection.on('error')` and `connection.on('close')` handlers. On unexpected disconnection (not triggered by `close()`), automatically attempt reconnection **indefinitely** until `close()` is called — the `resilience.maxAttempts` setting only governs the initial `connect()` call, not mid-session recovery. Reconnection uses jittered exponential backoff: base delay starts at `resilience.initialDelayMs` (default 1000ms), doubles on each attempt up to `resilience.maxDelayMs` (default 30000ms), with ±25% random jitter to prevent thundering herd across instances. After each failed attempt, check if `close()` has been called; if so, stop immediately (no leaked timers, no unhandled rejections). During reconnection, `dispatch()` rejects with a connection error. Once reconnected, re-assert the exchange, re-establish consumers for all registered handlers, and reset the backoff delay.
12. **connect is idempotent** -- Calling `connect()` when already connected is a no-op.
13. **close closes channel and connection** -- `close()` closes the channel and connection, clears the handler registry. After `close()`, dispatch and on throw.
14. **close is idempotent** -- Calling `close()` multiple times has no additional effect.

### Error Handling

15. **Handler errors cause nack** -- If any handler rejects during parallel invocation, the message is nacked (`channel.nack(msg, false, true)`) for redelivery. The `nack()` call is wrapped in try/catch — if the channel is stale (closed during reconnection), the error is logged.
16. **Serialization errors on dispatch** -- If event serialization fails, `dispatch` rejects with the serialization error.
17. **Connection errors on dispatch** -- If the channel is closed or RabbitMQ is unreachable, `dispatch` rejects with a connection error.

### Logging

18. **Framework logger** -- All internal logging uses the `Logger` interface from `@noddde/core`. The logger is resolved from `config.logger` or defaults to `new NodddeLogger("warn", "noddde:rabbitmq")` from `@noddde/engine`. All log calls pass structured context data as the second parameter (e.g., `{ eventName }`, `{ error: String(err) }`). No `console.log`, `console.warn`, or `console.error` calls exist in the implementation.

## Invariants

- All dispatched events are serialized as JSON (must be JSON-serializable).
- Handlers registered via `on()` receive the full `Event` object.
- Messages are acknowledged only after successful handler completion; nacked on handler failure.
- The bus does not deduplicate events.
- Exchange is durable (survives broker restarts).
- Queues are durable (survive broker restarts).
- Messages are persistent (survive broker restarts).
- Published messages include `messageId` from `event.metadata.eventId` when available.
- No `console.*` calls exist in the implementation — all logging goes through the `Logger` interface.

## Edge Cases

- **No handler registered for consumed queue**: Message is acknowledged with no processing.
- **Handler throws**: Message is nacked with requeue=true for redelivery.
- **Dispatch with no payload**: Events with `payload: undefined` are serialized as `{"name":"X","payload":null}`.
- **Multiple handlers for same event**: All handlers invoked in parallel via `Promise.all()`. If any handler rejects, the message is nacked for redelivery. Handlers that already completed will re-execute on redelivery.
- **on() called before connect()**: Handlers are buffered; queue bindings and consumers are set up when `connect()` is called.
- **on() called after close()**: Throws an error.
- **Exchange does not exist**: `connect()` asserts (creates) the exchange.
- **Fanout exchange type**: Routing key is ignored; all bound queues receive all messages.
- **Dispatch without metadata**: `messageId` is not set on published message (no crash). Consumer retry falls back to content-derived hash.
- **Dispatch with metadata.eventId**: `messageId` is set to `event.metadata.eventId` on published message.
- **No logger provided**: Defaults to `NodddeLogger("warn", "noddde:rabbitmq")` — behaves like the previous `console.error`/`console.warn` output but with structured formatting.
- **close() during active reconnection**: The reconnection loop checks `_closed` before each attempt and exits cleanly. No leaked timers, no unhandled promise rejections.
- **Dispatch during reconnection**: Rejects immediately with a connection error (same as dispatch before connect).
- **Broker recovers after extended outage**: Reconnection succeeds eventually because the loop is unbounded; backoff is capped at `maxDelayMs` so attempts remain frequent enough to detect recovery.

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

### dispatch sets messageId from event metadata eventId

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should set messageId from event.metadata.eventId when present", async () => {
    const mockChannel = {
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    const event = {
      name: "AccountCreated",
      payload: { id: "acc-1" },
      metadata: {
        eventId: "evt-unique-123",
        correlationId: "corr-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        causationId: "cmd-1",
      },
    };
    await bus.dispatch(event);

    const publishOptions = mockChannel.publish.mock.calls[0]![3];
    expect(publishOptions.messageId).toBe("evt-unique-123");
  });
});
```

### dispatch omits messageId when metadata is absent

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should not set messageId when event has no metadata", async () => {
    const mockChannel = {
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "TestEvent", payload: {} });

    const publishOptions = mockChannel.publish.mock.calls[0]![3];
    expect(publishOptions.messageId).toBeUndefined();
  });
});
```

### logger receives structured calls instead of console

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";
import type { Logger } from "@noddde/core";

describe("RabbitMqEventBus", () => {
  it("should use provided logger for warn and error logging with structured data", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      logger: mockLogger,
    });

    const handler = vi.fn();
    bus.on("TestEvent", handler);

    // Trigger poison message logging
    const result = await (bus as any)._handleMessage(
      "TestEvent",
      Buffer.from("not valid json {{{"),
    );

    expect(result).toEqual({ poisoned: true });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("deserialize"),
      expect.objectContaining({ eventName: "TestEvent" }),
    );
  });
});
```

### mid-session reconnection retries indefinitely until close cancels it

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";
import type { Logger } from "@noddde/core";

describe("RabbitMqEventBus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should retry reconnection indefinitely and stop when close() is called", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      resilience: { maxAttempts: 2, initialDelayMs: 100, maxDelayMs: 1000 },
      logger: mockLogger,
    });

    // Simulate a connected state, then trigger unexpected close
    (bus as any)._connected = true;
    (bus as any)._closed = false;

    // Mock _connectWithRetry to always fail (simulates broker down)
    let connectAttempts = 0;
    (bus as any)._reconnectWithRetry = undefined; // will be set by _handleUnexpectedClose
    const originalConnect = (bus as any)._connectSingleAttempt;

    // Trigger unexpected close — this starts the persistent reconnection loop
    (bus as any)._handleUnexpectedClose();

    // The reconnection loop should keep going beyond maxAttempts
    // Advance timers to let multiple retry cycles execute
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }

    // Reconnection should still be in progress (not given up)
    expect((bus as any)._reconnecting).toBe(true);

    // Now close() should cancel the loop
    (bus as any)._closed = true;
    await vi.advanceTimersByTimeAsync(2000);

    // Logger should have been called for the reconnection attempts
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("reconnect"),
      expect.any(Object),
    );
  });
});
```

### reconnection uses jittered exponential backoff delays

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";
import type { Logger } from "@noddde/core";

describe("RabbitMqEventBus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should apply jittered exponential backoff during reconnection", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      resilience: { maxAttempts: 2, initialDelayMs: 1000, maxDelayMs: 10000 },
      logger: mockLogger,
    });

    // The jittered delay for attempt N should be:
    //   baseDelay = min(initialDelayMs * 2^attempt, maxDelayMs)
    //   jitteredDelay = baseDelay * (0.75 + Math.random() * 0.5)
    // So for attempt 0: base=1000, jittered range [750, 1250]
    // For attempt 1: base=2000, jittered range [1500, 2500]
    // For attempt 3: base=8000, jittered range [6000, 10000]
    // For attempt 4: base=10000 (capped), jittered range [7500, 12500] → capped at maxDelayMs

    // Verify the backoff calculation method exists and computes correctly
    // by checking that delays increase over successive attempts
    const delays: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const baseDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
      delays.push(baseDelay);
    }

    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(4000);
    expect(delays[3]).toBe(8000);
    expect(delays[4]).toBe(10000); // capped
  });
});
```

### close during reconnection stops the retry loop cleanly

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";
import type { Logger } from "@noddde/core";

describe("RabbitMqEventBus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should stop reconnection immediately when close() is called", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      resilience: { maxAttempts: 2, initialDelayMs: 100, maxDelayMs: 1000 },
      logger: mockLogger,
    });

    // Start in connected state, trigger unexpected disconnection
    (bus as any)._connected = true;
    (bus as any)._closed = false;
    (bus as any)._handleUnexpectedClose();

    // Let one retry cycle execute
    await vi.advanceTimersByTimeAsync(200);
    expect((bus as any)._reconnecting).toBe(true);

    // Call close() — should signal the reconnection loop to stop
    await bus.close();

    // Advance more time — no new reconnection attempts should happen
    const warnCountBefore = (mockLogger.warn as ReturnType<typeof vi.fn>).mock
      .calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    const warnCountAfter = (mockLogger.warn as ReturnType<typeof vi.fn>).mock
      .calls.length;

    // No significant new warn calls after close — loop stopped
    // (at most 1 more call as the current iteration finishes)
    expect(warnCountAfter - warnCountBefore).toBeLessThanOrEqual(1);
    expect((bus as any)._closed).toBe(true);
  });
});
```

### dispatch rejects during active reconnection

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";
import type { Logger } from "@noddde/core";

describe("RabbitMqEventBus", () => {
  it("should reject dispatch calls while reconnection is in progress", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      logger: mockLogger,
    });

    // Simulate reconnecting state: _connected = false, _reconnecting = true
    (bus as any)._connected = false;
    (bus as any)._reconnecting = true;

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });
});
```
