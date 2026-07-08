---
title: "KafkaEventBus"
module: adapters/kafka/kafka-event-bus
source_file: packages/adapters/kafka/src/kafka-event-bus.ts
status: ready
exports: [KafkaEventBus, KafkaEventBusConfig]
depends_on:
  - core/edd/event-bus
  - core/edd/event
  - core/infrastructure/closeable
  - core/infrastructure/connectable
  - core/infrastructure/broker-resilience
  - core/infrastructure/logger
docs: []
---

# KafkaEventBus

> Kafka-backed EventBus implementation using `kafkajs`. Publishes domain events to Kafka topics and delivers them to registered handlers via consumer groups. Provides at-least-once delivery with partition-level ordering. Suitable for distributed, multi-process deployments where durable event streaming is required.

## Type Contract

```ts
import type {
  EventBus,
  AsyncEventHandler,
  Connectable,
  BrokerResilience,
  Logger,
  Event,
} from "@noddde/core";

/** Configuration for the KafkaEventBus. */
export interface KafkaEventBusConfig {
  /** Kafka broker addresses (e.g., ["localhost:9092"]). */
  brokers: string[];
  /** Client identifier for this Kafka client instance. */
  clientId: string;
  /** Consumer group ID. Events fan out across different group IDs. */
  groupId: string;
  /** Optional prefix prepended to event names to form topic names (e.g., "noddde." → "noddde.AccountCreated"). */
  topicPrefix?: string;
  /** Consumer session timeout in milliseconds (default: 30000). Increase if handlers are slow to avoid rebalances. */
  sessionTimeout?: number;
  /** Consumer heartbeat interval in milliseconds (default: 3000). Must be less than sessionTimeout / 3. */
  heartbeatInterval?: number;
  /** Connection resilience configuration (default: maxAttempts=6, initialDelayMs=300, maxDelayMs=30000). Mapped to kafkajs retry options. */
  resilience?: BrokerResilience;
  /**
   * Strategy for deriving the Kafka message key from an event.
   * - `"aggregateId"` (default): uses `event.metadata?.aggregateId` (stringified). Falls back to `null` (round-robin).
   * - Function: custom strategy receiving the event, returning the key string or `null`.
   */
  partitionKeyStrategy?: "aggregateId" | ((event: Event) => string | null);
  /** Framework logger instance. Defaults to NodddeLogger("warn", "noddde:kafka") from @noddde/engine. */
  logger?: Logger;
  /**
   * OpenTelemetry instrumentation used to enrich per-handler error logs with
   * `traceId`/`spanId` correlation fields. Defaults to a no-op instance.
   * Provided via `@noddde/engine` `Instrumentation`.
   */
  instrumentation?: Instrumentation;
  /**
   * When `true`, `connect()` automatically performs a `warmup()` round-trip
   * before resolving, so the returned promise only settles once the broker
   * has passed cold-start latency. Default: `false`.
   */
  warmupOnConnect?: boolean;
  /**
   * Timeout in milliseconds for the `warmup()` publish/consume round-trip
   * before it rejects. Default: `60000`.
   */
  warmupTimeoutMs?: number;
}

export class KafkaEventBus implements EventBus, Connectable {
  constructor(config: KafkaEventBusConfig);

  /** Establishes producer and consumer connections to the Kafka cluster. Must be called before dispatch or on. */
  connect(): Promise<void>;

  /** Registers a handler for a given event name. Subscribes to the corresponding Kafka topic. */
  on(eventName: string, handler: AsyncEventHandler): void;

  /** Publishes an event to the Kafka topic derived from the event name. */
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;

  /**
   * Performs a throwaway publish/consume round-trip on a dedicated internal
   * topic to force the Kafka cluster past cold-start latency (topic creation,
   * leader election, ISR sync) before real traffic flows. Must be called
   * after `connect()`. Idempotent: after the first successful call,
   * subsequent calls resolve immediately without repeating the round-trip.
   * Rejects if the round-trip doesn't complete within `warmupTimeoutMs`.
   */
  warmup(): Promise<void>;

  /** Disconnects producer and consumer, clears handlers. Idempotent. */
  close(): Promise<void>;
}
```

## Behavioral Requirements

### Dispatch

1. **Topic derivation** -- `dispatch(event)` publishes to a Kafka topic named `${topicPrefix}${event.name}` (default prefix is empty, so topic = event name).
2. **JSON serialization** -- The full event object (`{ name, payload, metadata? }`) is serialized as JSON in the message value.
3. **Message key via partition key strategy** -- The message key is derived from the `partitionKeyStrategy` config option. Default strategy is `"aggregateId"`: uses `event.metadata?.aggregateId` (stringified via `String()`) when present, falls back to `null` (round-robin partition assignment). When a custom function is provided, it receives the full event and returns the key string or `null`. This ensures per-aggregate ordering by default, which is the correct default for event sourcing.
4. **Producer acknowledgment** -- `dispatch` awaits the producer `send()` and resolves when Kafka acknowledges receipt (at-least-once for the publish side).
5. **Dispatch before connect throws** -- Calling `dispatch` before `connect()` throws an error.

### Subscription / Handler Registration

6. **on registers handlers by event name** -- `on(eventName, handler)` stores the handler in an internal registry keyed by event name. Multiple handlers per event name are supported (fan-out within the same process).
7. **Consumer subscription** -- When `connect()` is called (or when `on` is called after connect), the consumer subscribes to the topic `${topicPrefix}${eventName}` for each registered event name. If `on()` is called after `connect()` and the subscribe fails, the error is logged and the topic is removed from the subscribed set so a future `on()` call can retry. Subscribe errors must not be silently swallowed.
8. **Message deserialization with poison message protection** -- Incoming Kafka messages are deserialized from JSON. Deserialization is wrapped in try/catch. If `JSON.parse` throws (malformed message), the error is logged and the offset is committed (message skipped). Poison messages must never block the partition via infinite redelivery.
9. **Isolated parallel handler invocation** -- Handlers for the same event are invoked concurrently via `Promise.allSettled()` (not `Promise.all()`). This guarantees that **every registered handler runs to completion** even when some of them fail — siblings are never silenced or short-circuited by an earlier rejection. After all handlers settle, the bus iterates the rejected results and logs each one individually via the framework `Logger` at `error` level with structured fields (see "Per-handler error logging" below). If at least one handler rejected, `_handleMessage` then propagates a failure (re-throwing the first rejection's reason) so the outer consumer loop skips the offset commit and Kafka redelivers per the existing retry / maxRetries policy. Handlers that already completed will re-execute on redelivery — consumers must be idempotent. This differs from `EventEmitterEventBus` (which invokes sequentially within a single process) because broker adapters operate in distributed contexts where independent handlers (projections, sagas) should not block each other.

   9c. **Per-handler error logging** -- For each rejected handler, the bus calls `logger.error(message, fields)` exactly once with:

   - `eventName: string` — from `event.name`.
   - `eventId?: string` — from `event.metadata?.eventId` when present.
   - `handlerName: string` — read from the handler's `name` property; falls back to `event.name` when anonymous.
   - `error: { name, message, stack? }` — extracted from the caught exception. Non-`Error` rejection values are coerced via `String(value)` into `message`.
   - `traceId?: string` and `spanId?: string` — populated from the active OpenTelemetry span via the configured `Instrumentation` instance. Absent when no span is active or when `@opentelemetry/api` is not installed.
     9b. **maxRetries delivery limit** -- If `resilience.maxRetries` is configured, track delivery attempts using a custom Kafka header (`x-noddde-delivery-count`). On each message receipt, read the header, increment it, and check against `maxRetries`. If the count exceeds `maxRetries`, log a warning and commit the offset (skip the message). This prevents handler-level poison messages from blocking the partition indefinitely.

10. **Explicit offset commit after handlers** -- The consumer is configured with `autoCommit: false` in `consumer.run()`. After all handlers for a message have completed successfully (all promises in the `Promise.all` resolved), the offset is committed explicitly via `consumer.commitOffsets([{ topic, partition, offset: nextOffset }])` where `nextOffset` is `message.offset + 1` (as a string). This provides at-least-once delivery. Without explicit `commitOffsets()`, offsets are never persisted to Kafka and every consumer restart would reprocess all messages. After committing, the delivery count entry for this offset is pruned from the `_deliveryCounts` map to prevent unbounded memory growth.

### Backpressure

11. **Session timeout and heartbeat configuration** -- `connect()` passes `sessionTimeout` and `heartbeatInterval` to the kafkajs consumer constructor. Defaults: 30000ms session timeout, 3000ms heartbeat interval. This prevents consumer rebalances when handlers are slow.

### Connection Lifecycle

12. **connect establishes producer and consumer** -- `connect()` creates and connects the Kafka producer and consumer. The `resilience` config option (if provided) is mapped to kafkajs retry options: `maxAttempts-1` → `retries`, `initialDelayMs` → `initialRetryTime`, `maxDelayMs` → `maxRetryTime`. These are passed to the `new Kafka()` constructor. kafkajs handles reconnection natively.
13. **connect is idempotent and concurrent-safe** -- Calling `connect()` when already connected is a no-op. Concurrent `connect()` calls are deduplicated via a connection promise mutex — the second call awaits the first rather than starting a parallel connection attempt.
14. **close disconnects cleanly** -- `close()` first calls `consumer.stop()` to halt message processing and allow in-flight handlers to complete, then disconnects the producer and consumer, and clears the handler registry. After `close()`, dispatch and on throw. The `stop()` → `disconnect()` sequence prevents unhandled promise rejections from in-flight handlers.
15. **close is idempotent** -- Calling `close()` multiple times has no additional effect.

### Error Handling

16. **Handler errors propagate as message-level failure** -- After `Promise.allSettled` settles every registered handler and each rejection has been logged individually, `_handleMessage` re-throws the first rejected handler's reason. The outer consumer loop catches this and skips the offset commit, enabling Kafka redelivery per the existing retry / maxRetries policy. All sibling handlers ran to completion before this re-throw — none are silenced by an earlier rejection.
17. **Serialization errors on dispatch** -- If event serialization fails, `dispatch` rejects with the serialization error.
18. **Connection errors on dispatch** -- If the broker is unreachable during `dispatch`, the promise rejects with a connection error.

### Logging

19. **Framework logger** -- All internal logging uses the `Logger` interface from `@noddde/core`. The logger is resolved from `config.logger` or defaults to `new NodddeLogger("warn", "noddde:kafka")` from `@noddde/engine`. All log calls pass structured context data as the second parameter (e.g., `{ eventName }`, `{ topic }`, `{ error: String(err) }`). No `console.log`, `console.warn`, or `console.error` calls exist in the implementation.

### Warmup

20. **Explicit warmup round-trip** -- `warmup()` addresses broker-side cold-start latency that `connect()`'s `FETCH_START` wait does not cover (a freshly-deployed cluster's first end-to-end publish/consume cycle can take far longer than subsequent ones). It creates a uniquely-named internal topic (derived from `clientId`), ensures it exists via the Kafka admin client, registers an internal handler for it, and repeatedly dispatches a throwaway event to that topic (on a 1-second interval) until the internal handler observes it. `warmup()` must be called after `connect()`; calling it before `connect()` or after `close()` throws the same "not connected" error as `dispatch()`.
21. **Idempotent** -- After the first successful `warmup()` call, subsequent calls resolve immediately without repeating the round-trip. Concurrent overlapping calls are deduplicated via an in-flight promise mutex, mirroring `connect()`'s dedup pattern — the second caller awaits the first rather than starting a parallel round-trip.
22. **warmupOnConnect config** -- When `warmupOnConnect: true`, `connect()` calls `warmup()` internally after the consumer starts polling and before `connect()`'s returned promise resolves, so callers that opt in get a fully warmed bus from a single `await connect()`.
23. **Warmup timeout** -- If the round-trip doesn't complete within `warmupTimeoutMs` (default `60000`), `warmup()` rejects with a timeout error rather than hanging indefinitely.

## Invariants

- All dispatched events are serialized as JSON (must be JSON-serializable).
- Handlers registered via `on()` receive the full `Event` object.
- Offset commits happen only after every handler for the message has settled and none rejected.
- All registered handlers for an event delivery run to completion, even when some fail (per-handler isolation via `Promise.allSettled`).
- Each handler failure produces exactly one `logger.error` call with structured fields.
- The bus does not deduplicate events (same event dispatched twice = two deliveries).
- Topic names follow the pattern `${topicPrefix}${eventName}`.
- Message key defaults to `event.metadata?.aggregateId` (stringified) for per-aggregate partition ordering.
- No `console.*` calls exist in the implementation — all logging goes through the `Logger` interface.
- `warmup()` performs at most one real round-trip per bus instance; repeat calls after success are no-ops.

## Edge Cases

- **No handler registered for a consumed topic**: Message is acknowledged (committed) with no processing.
- **Handler throws**: Offset is not committed, message will be redelivered on next poll.
- **Dispatch with no payload**: Events with `payload: undefined` are serialized as `{"name":"X","payload":null}`.
- **Multiple handlers for same event**: All handlers are invoked in parallel via `Promise.allSettled()`. Every handler runs to completion. Each rejection is logged individually. If at least one rejected, the offset is not committed (enabling redelivery). Handlers that already completed will re-execute on redelivery.
- **Two handlers, one throws**: Both handlers run; one error log is emitted with the failed handler's name; offset is not committed → broker redelivers.
- **on() called before connect()**: Handlers are buffered; subscriptions happen when `connect()` is called.
- **on() called after close()**: Throws an error.
- **Large message payloads**: Subject to Kafka's `message.max.bytes` broker config. No framework-level compression.
- **Dispatch without metadata**: Message key is `null` (round-robin partition). No crash.
- **Dispatch with metadata.aggregateId**: Message key is `String(aggregateId)` by default.
- **Custom partitionKeyStrategy function**: Function receives the full event, returns key or `null`.
- **No logger provided**: Defaults to `NodddeLogger("warn", "noddde:kafka")`.
- **warmup() before connect()**: Throws the "not connected" error.
- **warmup() after close()**: Throws the "not connected" error.
- **warmup() called twice concurrently**: Both calls resolve once the single in-flight round-trip completes; only one round-trip is performed.
- **warmup() called after a prior successful warmup()**: Resolves immediately; no additional round-trip, no additional topic creation.
- **warmup() round-trip exceeds warmupTimeoutMs**: Rejects with a timeout error; does not hang indefinitely.
- **warmupOnConnect: true with broker unreachable**: `connect()` rejects with the warmup failure (propagated), consistent with `connect()` surfacing connection errors.

## Integration Points

- Provided via `DomainWiring.buses()` factory. `Domain.init()` auto-calls `connect()` via `Connectable` auto-discovery (no manual connect needed).
- `Domain.init()` calls `bus.on(eventName, handler)` to register projection, saga, and standalone event handlers (after auto-connect).
- `Domain.shutdown()` calls `bus.close()` (via `Closeable` auto-discovery) to disconnect cleanly.

## Test Scenarios

### dispatch publishes event to correct topic

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should publish event to topic derived from event name", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    // Inject mock kafka client
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.dispatch({ name: "AccountCreated", payload: { id: "acc-1" } });

    expect(mockProducer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "AccountCreated",
        messages: [
          expect.objectContaining({
            value: expect.stringContaining("AccountCreated"),
          }),
        ],
      }),
    );
  });
});
```

### dispatch uses topic prefix when configured

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should prepend topicPrefix to event name for topic", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      topicPrefix: "noddde.",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.dispatch({ name: "OrderPlaced", payload: {} });

    expect(mockProducer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "noddde.OrderPlaced" }),
    );
  });
});
```

### dispatch throws before connect

```ts
import { describe, it, expect } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should throw when dispatching before connect", async () => {
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
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
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should invoke registered handler when event is consumed", async () => {
    const handler = vi.fn();
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });

    bus.on("AccountCreated", handler);

    // Simulate consumer message delivery
    const event = { name: "AccountCreated", payload: { id: "acc-1" } };
    await (bus as any)._handleMessage("AccountCreated", JSON.stringify(event));

    expect(handler).toHaveBeenCalledWith(event);
  });
});
```

### multiple handlers for same event are invoked in parallel

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should invoke all handlers concurrently via Promise.all", async () => {
    const results: string[] = [];
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
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

    // Both handlers completed
    expect(results).toContain("slow");
    expect(results).toContain("fast");
    expect(results).toHaveLength(2);
    // "fast" completes before "slow" because they run in parallel
    expect(results[0]).toBe("fast");
  });
});
```

### parallel handler failure prevents offset commit while siblings still complete

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should reject _handleMessage after all handlers settled, with siblings completed", async () => {
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
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

    // The successful sibling completed even though another handler threw.
    expect(successHandler).toHaveBeenCalledOnce();
  });
});
```

### sibling handler completes when an earlier handler throws (Promise.allSettled)

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus error isolation", () => {
  it("should run every handler to completion even when an earlier one throws", async () => {
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });

    const before = vi.fn();
    const after = vi.fn();
    bus.on("E", before);
    bus.on("E", async () => {
      throw new Error("boom");
    });
    bus.on("E", after);

    await expect(
      (bus as any)._handleMessage(
        "E",
        JSON.stringify({ name: "E", payload: {} }),
      ),
    ).rejects.toThrow();

    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });
});
```

### individual logging per failed handler with handlerName and error fields

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";
import type { Logger } from "@noddde/core";

describe("KafkaEventBus error isolation", () => {
  it("should log once per failed handler with handlerName and error fields", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      logger,
    });

    async function failingA() {
      throw new Error("err-a");
    }
    async function failingB() {
      throw new Error("err-b");
    }
    bus.on("E", vi.fn());
    bus.on("E", failingA);
    bus.on("E", failingB);

    await expect(
      (bus as any)._handleMessage(
        "E",
        JSON.stringify({ name: "E", payload: {} }),
      ),
    ).rejects.toThrow();

    const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    // One error log per failed handler (2 failures → 2 log entries).
    const handlerErrorCalls = errorCalls.filter(
      ([, fields]) => (fields as any)?.handlerName !== undefined,
    );
    expect(handlerErrorCalls).toHaveLength(2);
    const names = handlerErrorCalls.map(([, f]) => (f as any).handlerName);
    expect(names).toEqual(expect.arrayContaining(["failingA", "failingB"]));
    const messages = handlerErrorCalls.map(
      ([, f]) => (f as any).error?.message,
    );
    expect(messages).toEqual(expect.arrayContaining(["err-a", "err-b"]));
  });
});
```

### offset commit behavior is unchanged under partial failure

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus error isolation", () => {
  it("should not commit the offset when any handler fails (existing redelivery behavior is preserved)", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const commitOffsets = vi.fn().mockResolvedValue(undefined);
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      commitOffsets,
      // The consumer's `run` is replaced by direct `_handleMessage` calls in this test,
      // so the test just verifies that `commitOffsets` is not called on the failure path.
      run: vi.fn().mockResolvedValue(undefined),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();

    bus.on("E", vi.fn());
    bus.on("E", async () => {
      throw new Error("boom");
    });

    await expect(
      (bus as any)._handleMessage(
        "E",
        JSON.stringify({ name: "E", payload: {} }),
        "topic:0:42",
      ),
    ).rejects.toThrow();

    // The Kafka consumer never commits the offset on a failed handler — broker
    // redelivers per existing retry/maxRetries semantics. Regression guard.
    expect(commitOffsets).not.toHaveBeenCalled();
  });
});
```

### connect maps resilience config to kafkajs retry options

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should map BrokerResilience to kafkajs retry configuration", () => {
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      resilience: {
        maxAttempts: 11,
        initialDelayMs: 500,
        maxDelayMs: 60000,
      },
    });

    // The resilience config should be stored for mapping during connect()
    expect((bus as any)._config.resilience).toEqual({
      maxAttempts: 11,
      initialDelayMs: 500,
      maxDelayMs: 60000,
    });
  });
});
```

### connect passes session timeout and heartbeat to consumer

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should configure consumer with sessionTimeout and heartbeatInterval", async () => {
    const mockProducer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const consumerFn = vi.fn().mockReturnValue(mockConsumer);
    const mockKafka = { producer: () => mockProducer, consumer: consumerFn };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      sessionTimeout: 60000,
      heartbeatInterval: 5000,
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();

    expect(consumerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "test-group",
        sessionTimeout: 60000,
        heartbeatInterval: 5000,
      }),
    );
  });
});
```

### close disconnects and clears handlers

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should disconnect and clear handlers on close", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    bus.on("TestEvent", vi.fn());
    await bus.close();

    expect(mockProducer.disconnect).toHaveBeenCalled();
    expect(mockConsumer.disconnect).toHaveBeenCalled();

    // Dispatch after close should throw
    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow();
  });
});
```

### close is idempotent

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should not throw when close is called multiple times", async () => {
    const mockProducer = {
      send: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.close();
    await expect(bus.close()).resolves.toBeUndefined();
  });
});
```

### dispatch serializes full event as JSON

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should serialize the full event object including metadata", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    const event = {
      name: "AccountCreated",
      payload: { id: "acc-1" },
      metadata: { eventId: "evt-1", correlationId: "corr-1" },
    };
    await bus.dispatch(event);

    const sentValue = mockProducer.send.mock.calls[0]![0].messages[0].value;
    const parsed = JSON.parse(sentValue);
    expect(parsed).toEqual(event);
  });
});
```

### default partition key strategy uses aggregateId

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should use aggregateId as message key by default", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.dispatch({
      name: "OrderPlaced",
      payload: {},
      metadata: {
        eventId: "evt-1",
        correlationId: "corr-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        causationId: "cmd-1",
        aggregateId: "order-123",
      },
    } as any);

    const sentKey = mockProducer.send.mock.calls[0]![0].messages[0].key;
    expect(sentKey).toBe("order-123");
  });
});
```

### partition key is null when aggregateId is absent

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should use null key when event has no aggregateId", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.dispatch({ name: "TestEvent", payload: {} });

    const sentKey = mockProducer.send.mock.calls[0]![0].messages[0].key;
    expect(sentKey).toBeNull();
  });
});
```

### custom partition key strategy function

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus", () => {
  it("should use custom function for partition key when provided", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      partitionKeyStrategy: (event) => `custom-${event.name}`,
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.dispatch({ name: "OrderPlaced", payload: {} });

    const sentKey = mockProducer.send.mock.calls[0]![0].messages[0].key;
    expect(sentKey).toBe("custom-OrderPlaced");
  });
});
```

### logger receives structured calls instead of console

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";
import type { Logger } from "@noddde/core";

describe("KafkaEventBus", () => {
  it("should use provided logger for warn logging with structured data", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      logger: mockLogger,
    });

    const handler = vi.fn();
    bus.on("TestEvent", handler);

    // Trigger poison message logging via _handleMessage
    await (bus as any)._handleMessage("TestEvent", "not valid json {{{");

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("deserialize"),
      expect.objectContaining({ eventName: "TestEvent" }),
    );
  });
});
```

### warmup performs a publish/consume round-trip on an internal topic

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

function createMockKafka() {
  const handlers: Record<
    string,
    (payload: { message: { value: Buffer } }) => Promise<void>
  > = {};
  const mockProducer = {
    send: vi.fn(async ({ topic, messages }) => {
      const eachMessage = handlers["eachMessage"];
      if (eachMessage) {
        await eachMessage({
          message: {
            value: Buffer.from(messages[0].value as string),
            offset: "0",
          },
          topic,
          partition: 0,
        } as any);
      }
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const mockConsumer = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockImplementation(async ({ eachMessage }) => {
      handlers["eachMessage"] = eachMessage;
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    commitOffsets: vi.fn().mockResolvedValue(undefined),
    events: { FETCH_START: "consumer.fetch_start" },
    on: vi.fn().mockImplementation((_event, cb) => {
      cb();
      return () => {};
    }),
  };
  const mockAdmin = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    createTopics: vi.fn().mockResolvedValue(true),
  };
  return {
    mockKafka: {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
      admin: () => mockAdmin,
    },
    mockProducer,
    mockConsumer,
    mockAdmin,
  };
}

describe("KafkaEventBus warmup", () => {
  it("should create the warmup topic, dispatch, and resolve once the round-trip is observed", async () => {
    const { mockKafka, mockAdmin, mockProducer } = createMockKafka();
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.warmup();

    expect(mockAdmin.createTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        waitForLeaders: true,
        topics: [
          expect.objectContaining({ topic: expect.stringContaining("test") }),
        ],
      }),
    );
    expect(mockProducer.send).toHaveBeenCalled();
  });
});
```

### warmup is idempotent

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus warmup", () => {
  it("should not repeat the round-trip on a second call after success", async () => {
    const handlers: Record<string, (payload: any) => Promise<void>> = {};
    const mockProducer = {
      send: vi.fn(async ({ topic, messages }) => {
        const eachMessage = handlers["eachMessage"];
        if (eachMessage) {
          await eachMessage({
            message: {
              value: Buffer.from(messages[0].value as string),
              offset: "0",
            },
            topic,
            partition: 0,
          });
        }
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockImplementation(async ({ eachMessage }) => {
        handlers["eachMessage"] = eachMessage;
      }),
      stop: vi.fn().mockResolvedValue(undefined),
      commitOffsets: vi.fn().mockResolvedValue(undefined),
      events: { FETCH_START: "consumer.fetch_start" },
      on: vi.fn().mockImplementation((_event, cb) => {
        cb();
        return () => {};
      }),
    };
    const mockAdmin = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      createTopics: vi.fn().mockResolvedValue(true),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
      admin: () => mockAdmin,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.warmup();
    const callsAfterFirst = mockAdmin.createTopics.mock.calls.length;
    await bus.warmup();

    expect(mockAdmin.createTopics.mock.calls.length).toBe(callsAfterFirst);
  });
});
```

### warmup throws before connect

```ts
import { describe, it, expect } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus warmup", () => {
  it("should throw when warmup is called before connect", async () => {
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });

    await expect(bus.warmup()).rejects.toThrow(/not connected/i);
  });
});
```

### warmupOnConnect runs warmup as part of connect

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus warmup", () => {
  it("should perform the warmup round-trip during connect when warmupOnConnect is true", async () => {
    const handlers: Record<string, (payload: any) => Promise<void>> = {};
    const mockProducer = {
      send: vi.fn(async ({ topic, messages }) => {
        const eachMessage = handlers["eachMessage"];
        if (eachMessage) {
          await eachMessage({
            message: {
              value: Buffer.from(messages[0].value as string),
              offset: "0",
            },
            topic,
            partition: 0,
          });
        }
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockImplementation(async ({ eachMessage }) => {
        handlers["eachMessage"] = eachMessage;
      }),
      stop: vi.fn().mockResolvedValue(undefined),
      commitOffsets: vi.fn().mockResolvedValue(undefined),
      events: { FETCH_START: "consumer.fetch_start" },
      on: vi.fn().mockImplementation((_event, cb) => {
        cb();
        return () => {};
      }),
    };
    const mockAdmin = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      createTopics: vi.fn().mockResolvedValue(true),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
      admin: () => mockAdmin,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      warmupOnConnect: true,
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();

    expect(mockAdmin.createTopics).toHaveBeenCalled();
    expect(mockProducer.send).toHaveBeenCalled();
  });
});
```

### warmup times out when the round-trip never completes

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus warmup", () => {
  it("should reject with a timeout error when the handler never observes the warmup event", async () => {
    const mockProducer = {
      // Never invokes eachMessage — simulates a broker that swallows the warmup publish.
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      commitOffsets: vi.fn().mockResolvedValue(undefined),
      events: { FETCH_START: "consumer.fetch_start" },
      on: vi.fn().mockImplementation((_event, cb) => {
        cb();
        return () => {};
      }),
    };
    const mockAdmin = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      createTopics: vi.fn().mockResolvedValue(true),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
      admin: () => mockAdmin,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      warmupTimeoutMs: 50,
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();

    await expect(bus.warmup()).rejects.toThrow(/timed out/i);
  }, 10_000);
});
```
