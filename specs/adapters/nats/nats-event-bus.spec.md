---
title: "NatsEventBus"
module: adapters/nats/nats-event-bus
source_file: packages/adapters/nats/src/nats-event-bus.ts
status: implemented
exports: [NatsEventBus, NatsEventBusConfig]
depends_on:
  - core/edd/event-bus
  - core/edd/event
  - core/infrastructure/closeable
  - core/infrastructure/connectable
  - core/infrastructure/broker-resilience
  - core/infrastructure/logger
docs:
  - docs/content/docs/running/event-bus-adapters.mdx
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
  Logger,
} from "@noddde/core";

/** Configuration for the NatsEventBus. */
export interface NatsEventBusConfig {
  /** NATS server URL(s) (e.g., "localhost:4222" or ["nats://host1:4222", "nats://host2:4222"]). */
  servers: string | string[];
  /**
   * Consumer group identity. Used as prefix for JetStream durable consumer names.
   * Two services with different consumerGroup values independently consume the same stream
   * without stealing each other's messages. Analogous to Kafka's groupId.
   */
  consumerGroup: string;
  /** JetStream stream name for durable subscriptions (e.g., "noddde-events"). */
  streamName?: string;
  /** Optional prefix prepended to event names to form subject names (e.g., "noddde." → "noddde.AccountCreated"). */
  subjectPrefix?: string;
  /** Maximum number of unacknowledged messages per consumer (default: 256). Provides backpressure control. */
  prefetchCount?: number;
  /** Connection resilience configuration (default: maxAttempts=-1/infinite, initialDelayMs=2000). NATS uses fixed intervals — maxDelayMs is ignored. */
  resilience?: BrokerResilience;
  /** Framework logger instance. Defaults to NodddeLogger("warn", "noddde:nats") from @noddde/engine. */
  logger?: Logger;
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
6. **JetStream consumer with group-scoped durable name** -- When subscriptions are activated (after `connect()`), a JetStream consumer is created for each registered event name's subject. The durable consumer name is `${consumerGroup}_${sanitized(eventName)}` where `sanitized` replaces non-alphanumeric characters (except `_` and `-`) with underscores. This ensures two services with different `consumerGroup` values get independent durable consumers on the same stream — they do not share cursor positions or steal each other's messages.
7. **Message deserialization with poison message protection** -- Incoming NATS messages are deserialized from JSON in `_consumeSubscription`. Deserialization is wrapped in try/catch. If `JSON.parse` throws (malformed message), the error is logged and `msg.term()` is called to permanently discard it. The `msg.term()` call is itself wrapped in try/catch — if the connection dropped between receipt and term, the error is logged but the consumer loop continues to the next message.
8. **Parallel handler invocation** -- Handlers for the same event are invoked concurrently via `Promise.all()`. If any handler rejects, `msg.nak()` is called for immediate redelivery (instead of silently relying on the ack timeout). The error is logged with event name and error details. The `msg.nak()` call is itself wrapped in try/catch — if the connection dropped, the error is logged but the consumer loop continues. Handlers that already completed will re-execute on redelivery — consumers must be idempotent.
9. **Ack after handlers** -- The message is acknowledged (`msg.ack()`) only after all handlers have completed successfully. The `msg.ack()` call is wrapped in try/catch for the same connection-drop resilience as nak/term.

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
    15b. **Consumer loop error propagation** -- The consumer loop promise (`_consumeSubscription`) must NOT be fire-and-forget (`void`). It must have a `.catch()` handler that logs the error. If the async iterator throws (e.g., connection drop), the error is caught and logged instead of becoming an unhandled promise rejection.
16. **Serialization errors on dispatch** -- If event serialization fails, `dispatch` rejects with the serialization error.
17. **Connection errors on dispatch** -- If the NATS server is unreachable, `dispatch` rejects with a connection error.

### Fail-Fast Connect

18. **connect rejects on subscription failure** -- During `connect()`, if any call to `_createSubscriptionForEvent()` in `_activateSubscriptions()` throws, `connect()` must reject with the error. The caller must know the bus is not fully operational. Subscription failures via late `on()` calls (after `connect()` has already resolved) are logged via the logger but do not crash the process.

### Logging

19. **Framework logger** -- All internal logging uses the `Logger` interface from `@noddde/core`. The logger is resolved from `config.logger` or defaults to `new NodddeLogger("warn", "noddde:nats")` from `@noddde/engine`. All log calls pass structured context data as the second parameter (e.g., `{ eventName }`, `{ error: String(err) }`). No `console.log`, `console.warn`, or `console.error` calls exist in the implementation.

## Invariants

- All dispatched events are serialized as JSON (must be JSON-serializable).
- Handlers registered via `on()` receive the full `Event` object.
- Messages are acknowledged only after successful handler completion.
- The bus does not deduplicate events.
- Subject names follow the pattern `${subjectPrefix}${eventName}`.
- JetStream durable consumer names follow the pattern `${consumerGroup}_${sanitized(eventName)}`.
- Two bus instances with different `consumerGroup` values on the same stream maintain independent consumer cursors.
- JetStream provides durable message storage — events survive broker restarts.
- No `console.*` calls exist in the implementation — all logging goes through the `Logger` interface.

## Edge Cases

- **No handler registered for consumed subject**: Message is acknowledged with no processing.
- **Handler throws**: Message is not acknowledged; NATS redelivers based on consumer config.
- **Dispatch with no payload**: Events with `payload: undefined` are serialized as `{"name":"X","payload":null}`.
- **Multiple handlers for same event**: All handlers invoked in parallel via `Promise.all()`. If any handler rejects, the message is not acknowledged (enabling redelivery). Handlers that already completed will re-execute on redelivery.
- **on() called before connect()**: Handlers are buffered; subscriptions happen when `connect()` is called.
- **on() called after close()**: Throws an error.
- **Stream does not exist**: `connect()` creates the stream if `streamName` is configured and stream does not exist.
- **Two services with different consumerGroup on same stream**: Each gets its own durable consumer — independent cursor positions, no message stealing.
- **Subscription creation fails during connect**: `connect()` rejects with the error. The bus is not marked as connected.
- **Subscription creation fails during late on()**: Error is logged via `this._logger.error()`. The handler is still registered (retry on next connection cycle).
- **No logger provided**: Defaults to `NodddeLogger("warn", "noddde:nats")` — behaves like the previous `console.error`/`console.warn` output but with structured formatting.

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

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
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
      consumerGroup: "test-group",
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
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

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
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

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
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

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
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

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
      consumerGroup: "test-group",
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
      consumerGroup: "test-group",
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
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
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
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
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

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
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

### consumerGroup scopes durable consumer names

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should use consumerGroup as prefix in durable consumer name", async () => {
    const mockOpts = {
      durable: vi.fn(),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
    };

    const mockSub = (async function* () {})();
    const mockJs = {
      subscribe: vi.fn().mockResolvedValue(mockSub),
    };

    const natsModule = await import("nats");
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "order-service",
    });
    (bus as any)._js = mockJs;
    (bus as any)._connected = true;

    bus.on("AccountCreated", vi.fn());

    await new Promise((r) => setTimeout(r, 10));

    expect(mockOpts.durable).toHaveBeenCalledWith(
      "order-service_AccountCreated",
    );

    vi.restoreAllMocks();
  });
});
```

### different consumerGroup values produce independent durable names

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should produce different durable names for different consumerGroup values on the same event", async () => {
    const durableNames: string[] = [];
    const mockOpts = {
      durable: vi.fn((name: string) => durableNames.push(name)),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
    };

    const mockSub = (async function* () {})();
    const mockJs = {
      subscribe: vi.fn().mockResolvedValue(mockSub),
    };

    const natsModule = await import("nats");
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus1 = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "billing-service",
    });
    (bus1 as any)._js = mockJs;
    (bus1 as any)._connected = true;
    bus1.on("OrderPlaced", vi.fn());

    await new Promise((r) => setTimeout(r, 10));

    const bus2 = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "shipping-service",
    });
    (bus2 as any)._js = mockJs;
    (bus2 as any)._connected = true;
    bus2.on("OrderPlaced", vi.fn());

    await new Promise((r) => setTimeout(r, 10));

    expect(durableNames).toContain("billing-service_OrderPlaced");
    expect(durableNames).toContain("shipping-service_OrderPlaced");
    expect(durableNames[0]).not.toBe(durableNames[1]);

    vi.restoreAllMocks();
  });
});
```

### connect rejects when subscription creation fails

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should reject connect() when subscription creation fails during _activateSubscriptions", async () => {
    const natsModule = await import("nats");

    vi.spyOn(natsModule, "connect").mockResolvedValue({
      jetstream: () => ({
        subscribe: vi.fn().mockRejectedValue(new Error("subscription failed")),
      }),
      jetstreamManager: vi.fn().mockResolvedValue({
        streams: { info: vi.fn() },
      }),
      drain: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
    } as any);

    const mockOpts = {
      durable: vi.fn(),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
    };
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-service",
    });

    // Register a handler before connect so _activateSubscriptions runs
    bus.on("TestEvent", vi.fn());

    await expect(bus.connect()).rejects.toThrow("subscription failed");

    vi.restoreAllMocks();
  });
});
```

### logger receives structured calls instead of console

```ts
import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";
import type { Logger } from "@noddde/core";

describe("NatsEventBus", () => {
  it("should use provided logger for error and warn logging with structured data", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-service",
      logger: mockLogger,
    });

    const handler = vi.fn().mockRejectedValue(new Error("handler boom"));
    bus.on("TestEvent", handler);

    const event = { name: "TestEvent", payload: {} };
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(event)),
      nak: vi.fn(),
      ack: vi.fn(),
      term: vi.fn(),
    };

    const sub = (async function* () {
      yield msg;
    })();

    await (bus as any)._consumeSubscription(sub, "TestEvent");

    // Logger should have been called with structured data, not console
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Handler error"),
      expect.objectContaining({ eventName: "TestEvent" }),
    );
  });
});
```
