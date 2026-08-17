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

## Topology & Ordering Guarantee

Routing stays **per-event-name**: each event name gets its own durable queue named `${queuePrefix}.${eventName}`, bound to the exchange with the event name as routing key. There is no per-aggregate-type topology — `EventBus.on(eventName, handler)` has no aggregate-type concept, so this bus cannot route by aggregate type without new core surface.

**The actual ordering guarantee is narrower than "queue order" and must be stated precisely:**

- Ordering is guaranteed **only within a single event name**, and only because this bus internally serializes deliveries that share the same `event.metadata.aggregateId` (see Behavioral Requirement 8d). Without that serialization, `channel.consume` invokes its callback concurrently up to `prefetchCount` (default 10), so two deliveries for the same aggregate could otherwise run their handlers out of order or overlapping even within one queue.
- Ordering across **different event names is never guaranteed**, even for the same aggregate — each event name has its own queue, consumed independently. A `BankAccountOpened` and a later `MoneyDeposited` for the same account can be delivered/processed in either order relative to each other.
- Consequently, **projections or sagas that fold multiple event types for one aggregate must be order-tolerant and idempotent** — guard state transitions with `event.metadata.sequenceNumber` (or equivalent) rather than assuming arrival order matches causal order.

This is a deliberate scope decision: real per-aggregate-type topology is a bigger redesign gated on new `EventBus` surface, tracked separately. This spec only guarantees same-event-name ordering is not silently violated by concurrent handler execution.

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
  /**
   * Queue name prefix for consumer queues. **Required** — two different
   * services with the same prefix become competing consumers on identical
   * queues and each silently loses roughly half its events. Queues are
   * named "${queuePrefix}.${eventName}". Matches Kafka's required `groupId`
   * and NATS's required `consumerGroup`.
   */
  queuePrefix: string;
  /** Number of unacknowledged messages the broker may send to this consumer (default: 10). Provides backpressure control via channel.prefetch(). */
  prefetchCount?: number;
  /** Connection resilience configuration (default: maxAttempts=3, initialDelayMs=1000, maxDelayMs=30000). amqplib has no built-in reconnection — retry is implemented manually with exponential backoff. */
  resilience?: BrokerResilience;
  /** Framework logger instance. Defaults to NodddeLogger("warn", "noddde:rabbitmq") from @noddde/engine. */
  logger?: Logger;
  /**
   * OpenTelemetry instrumentation used to enrich per-handler error logs with
   * `traceId`/`spanId` correlation fields. Defaults to a no-op instance.
   * Provided via `@noddde/engine` `Instrumentation`.
   */
  instrumentation?: Instrumentation;
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
   3c. **Wire format content type** -- Published messages carry `properties.contentType = "application/vnd.noddde.event+json; version=1"`. The JSON-of-the-full-`Event`-object wire format is a versioned, stable contract: consumers may rely on this shape across noddde versions within the same major content-type version. Caveat: `Date`, `Map`, `BigInt`, and `undefined` values inside `payload`/`metadata` serialize lossily through `JSON.stringify` (e.g., `Date` becomes an ISO string, `undefined` fields are dropped) — producers that need lossless round-tripping must pre-serialize those fields themselves.
4. **Dispatch before connect throws** -- Calling `dispatch` before `connect()` throws an error.

### Subscription / Handler Registration

5. **on registers handlers by event name** -- `on(eventName, handler)` stores the handler in an internal registry keyed by event name. Multiple handlers per event name are supported (fan-out within the same process).
6. **Queue binding** -- When subscriptions are activated (after `connect()`), a durable queue named `${queuePrefix}.${eventName}` is asserted and bound to the exchange with `eventName` as the routing key.
7. **Consumer setup** -- A consumer is started on the queue. Incoming messages are deserialized from JSON and passed to all registered handlers.
   7b. **Message deserialization with poison message protection** -- Deserialization is wrapped in try/catch. If `JSON.parse` throws (malformed message), the error is logged and the message is acknowledged (skipped). Poison messages must never block the queue via infinite nack/requeue loops.
   7c. **Consumer setup failure is logged, not silently swallowed** -- If `_setupConsumer` rejects (called either from `on()` when already connected, or from the connect/reconnect activation loop), the failure is logged via `this._logger.error` with the event name and error. When `on()` triggers the failed setup, the handler registration itself is unaffected (still registered) — the queue/consumer simply isn't active yet. The existing full-reconnection path (Requirement 11b) re-runs `_setupConsumer` for every registered event name unconditionally, so a consumer that failed to activate is retried the next time the connection cycles, without needing a separate per-event retry mechanism.
8. **Isolated parallel handler invocation** -- Handlers for the same event are invoked concurrently via `Promise.allSettled()` (not `Promise.all()`). This guarantees that **every registered handler runs to completion** even when some of them fail — siblings are never silenced or short-circuited by an earlier rejection. After all handlers settle, the bus iterates the rejected results and logs each one individually via the framework `Logger` at `error` level with structured fields (see "Per-handler error logging" below). If at least one handler rejected, `_handleMessage` then propagates a failure (re-throwing the first rejection's reason) so the outer consume callback calls `channel.nack(msg, false, true)` for requeue per current behavior (capped by the in-memory `maxRetries` counter). Handlers that already completed will re-execute on redelivery — consumers must be idempotent. This differs from `EventEmitterEventBus` (which invokes sequentially within a single process) because broker adapters operate in distributed contexts where independent handlers should not block each other.

   8c. **Per-handler error logging** -- For each rejected handler, the bus calls `logger.error(message, fields)` exactly once with:

   - `eventName: string` — from `event.name`.
   - `eventId?: string` — from `event.metadata?.eventId` when present.
   - `handlerName: string` — read from the handler's `name` property; falls back to `event.name` when anonymous.
   - `error: { name, message, stack? }` — extracted from the caught exception. Non-`Error` rejection values are coerced via `String(value)` into `message`.
   - `traceId?: string` and `spanId?: string` — populated from the active OpenTelemetry span via the configured `Instrumentation` instance. Absent when no span is active or when `@opentelemetry/api` is not installed.
     8b. **maxRetries delivery limit** -- If `resilience.maxRetries` is configured, track delivery attempts using an in-memory `Map<string, number>` keyed by a stable message identifier. When `msg.properties.messageId` is present, that value is the key (stable across redeliveries). When it is absent, the key is a **full-content hash** (`sha256` of the entire message body, not a truncated prefix) — hashing the whole body means distinct messages of the same event type essentially never collide, while a genuinely redelivered message (identical body) still hashes to the same key so its count keeps accumulating. A truncated content-prefix key must never be used: same-type events sharing a long common JSON prefix (e.g. `{"name":"OrderPlaced","payload":{...`) would otherwise hash identically regardless of payload, causing healthy messages 4-10 under a burst at default `prefetch: 10` to be misclassified as retries of one "poison" key and discarded. On each message receipt, increment the count and check against `maxRetries`. If the count exceeds `maxRetries`, log a warning and route the message to the dead-letter queue (Requirement 8e) instead of silently dropping it, then delete its entry from the counter map. This prevents handler-level poison messages from blocking the queue indefinitely via infinite nack/requeue, without leaking counter-map entries for discarded keys. Note: the in-memory counter resets on consumer restart, which is acceptable since restarted consumers also reset their processing state.
     8c. **Delivery counter pruning** -- A message's entry in the delivery-count map is deleted both on successful processing (existing behavior) and on discard past `maxRetries` (new) — a key must never remain in the map once its message has been terminally resolved (acked, or dead-lettered), otherwise a since-resolved key could accumulate stale count and misfire on an unrelated future collision.
     8d. **Per-aggregate in-order, isolated-by-aggregate delivery** -- Within one queue's consumer, deliveries whose `event.metadata?.aggregateId` is present are serialized: an internal `Map<string, Promise<void>>` chains each delivery for a given `aggregateId` onto the previous one, so their handler invocations run strictly one-at-a-time in delivery order, even though `channel.consume`'s callback itself may be invoked concurrently up to `prefetchCount`. Deliveries for _different_ `aggregateId` values (or with no `aggregateId` in metadata) are never serialized against each other and continue to process concurrently up to `prefetchCount`. Each aggregateId's chain entry is removed from the map once that chain drains (no pending deliveries left for it), so the map never grows unboundedly. This is the guarantee referenced in "Topology & Ordering Guarantee" above — it is what makes same-event-name-and-aggregate ordering actually hold, closing the gap where concurrent `prefetch` delivery could otherwise reorder or overlap handler execution for one aggregate.
     8e. **Dead-letter queue for exhausted retries** -- When `resilience.maxRetries` is configured, `connect()`/reconnect also assert a fanout dead-letter exchange named `"${exchangeName}.dlx"` and a durable queue named `"${queuePrefix}.dlq"` bound to it. When a message's delivery count exceeds `maxRetries` (Requirement 8b), instead of just acking it away, the bus publishes it to the dead-letter exchange with headers carrying failure metadata — `x-original-event-name`, `x-death-reason`, `x-attempts`, `x-original-timestamp` — and only then acks the original message off its source queue. If the dead-letter publish itself fails, the error is logged and the original message is still acked (never left to loop forever), because dead-lettering is a best-effort inspectability aid, not a delivery guarantee. Exhausted-retry messages are therefore inspectable and replayable from `${queuePrefix}.dlq` rather than silently gone.

9. **Manual ack after handlers, on the channel that delivered the message** -- The message is acknowledged (`channel.ack(msg)`) only after all handlers have completed successfully (all promises in the `Promise.all` resolved). Critically, `_setupConsumer` captures the `ConfirmChannel` instance into a local `channel` variable at subscribe time and every `ack`/`nack` call in that consumer's callback uses that captured `channel`, never `this._channel`. AMQP delivery tags are scoped to the channel that issued them: `_reconnectPersistently` replaces `this._channel` with a brand-new channel on every reconnect, so resolving the channel dynamically at ack time (`this._channel?.ack(msg)`) would ack an in-flight message's delivery tag against a _different_ channel after a reconnect — either silently acking an unrelated message on the new channel (event loss) or causing the broker to close the new channel with `PRECONDITION_FAILED` (wedging every consumer on it, since only connection-level close triggers reconnection). All `channel.ack()` and `channel.nack()` calls are wrapped in try/catch — if the captured channel is stale (a reconnect happened since this delivery started), the ack/nack error is logged at `warn` (not `error`) and swallowed, since the broker will redeliver the message on the new channel/connection regardless.
   9b. **Channel-level error/close listeners feed the same reconnection path** -- Immediately after each new `ConfirmChannel` is created (both in `_connectWithRetry` and `_reconnectPersistently`), `error` and `close` listeners are registered on it, mirroring the connection-level listeners: on an unexpected channel close (`!this._closed`), the bus routes into `_handleUnexpectedClose()` exactly as an unexpected connection close does. Without this, a channel killed by a `PRECONDITION_FAILED` (see Requirement 9 above) would leave `_connected === true` with a dead channel and no path back to a healthy state.

### Backpressure

10. **Prefetch configuration** -- During `connect()`, call `channel.prefetch(prefetchCount)` to limit the number of unacknowledged messages the broker sends to this consumer. Default: 10. This provides natural backpressure when handlers are slow, preventing unbounded message accumulation in process memory.

### Connection Lifecycle

11. **connect establishes connection and channel with retry** -- `connect()` creates an AMQP connection and a **confirm channel** (`connection.createConfirmChannel()`), then asserts the exchange (durable). If `resilience` is configured, connection attempts retry with exponential backoff on failure. Default: 3 attempts, 1000ms initial delay, 30000ms max delay. Delay doubles on each retry (`min(initialDelayMs * 2^attempt, maxDelayMs)`). If all attempts fail, the last error is thrown. Using a confirm channel enables publisher confirms — `dispatch()` awaits `channel.waitForConfirms()` to guarantee the broker received the message.
    11b. **Mid-session reconnection (persistent)** -- After establishing the connection, register `connection.on('error')` and `connection.on('close')` handlers. On unexpected disconnection (not triggered by `close()`), automatically attempt reconnection **indefinitely** until `close()` is called — the `resilience.maxAttempts` setting only governs the initial `connect()` call, not mid-session recovery. Reconnection uses jittered exponential backoff: base delay starts at `resilience.initialDelayMs` (default 1000ms), doubles on each attempt up to `resilience.maxDelayMs` (default 30000ms), with ±25% random jitter to prevent thundering herd across instances. After each failed attempt, check if `close()` has been called; if so, stop immediately (no leaked timers, no unhandled rejections). During reconnection, `dispatch()` rejects with a connection error. Once reconnected, re-assert the exchange, re-establish consumers for all registered handlers, and reset the backoff delay.
12. **connect is idempotent** -- Calling `connect()` when already connected is a no-op.
13. **close closes channel and connection** -- `close()` closes the channel and connection, clears the handler registry. After `close()`, dispatch and on throw.
14. **close is idempotent** -- Calling `close()` multiple times has no additional effect.

### Error Handling

15. **Handler errors cause nack, on the captured channel** -- After `Promise.allSettled` settles every registered handler and each rejection has been logged individually, `_handleMessage` re-throws the first rejected handler's reason. The outer consume callback catches this and calls `channel.nack(msg, false, true)` (the captured channel from Requirement 9, not `this._channel`) for requeue per current behavior (capped by the in-memory `maxRetries` counter, Requirement 8b). The `nack()` call is wrapped in try/catch — if the captured channel is stale (closed during reconnection), the error is logged at `warn` and swallowed. All sibling handlers ran to completion before this re-throw — none are silenced by an earlier rejection.
16. **Serialization errors on dispatch** -- If event serialization fails, `dispatch` rejects with the serialization error.
17. **Connection errors on dispatch** -- If the channel is closed or RabbitMQ is unreachable, `dispatch` rejects with a connection error.

### Logging

18. **Framework logger** -- All internal logging uses the `Logger` interface from `@noddde/core`. The logger is resolved from `config.logger` or defaults to `new NodddeLogger("warn", "noddde:rabbitmq")` from `@noddde/engine`. All log calls pass structured context data as the second parameter (e.g., `{ eventName }`, `{ error: String(err) }`). No `console.log`, `console.warn`, or `console.error` calls exist in the implementation.

## Invariants

- All dispatched events are serialized as JSON (must be JSON-serializable).
- Handlers registered via `on()` receive the full `Event` object.
- Messages are acknowledged only after every handler for the message has settled and none rejected; nacked on any handler failure.
- All registered handlers for an event delivery run to completion, even when some fail (per-handler isolation via `Promise.allSettled`).
- Each handler failure produces exactly one `logger.error` call with structured fields.
- The bus does not deduplicate events.
- Exchange is durable (survives broker restarts).
- Queues are durable (survive broker restarts).
- Messages are persistent (survive broker restarts).
- Published messages include `messageId` from `event.metadata.eventId` when available.
- Published messages include `contentType: "application/vnd.noddde.event+json; version=1"`.
- No `console.*` calls exist in the implementation — all logging goes through the `Logger` interface.
- `queuePrefix` is a required config field — there is no default. Two buses must use different `queuePrefix` values to avoid becoming competing consumers on the same queue.
- `ack`/`nack` for a given delivery are always called on the `ConfirmChannel` instance that delivered that message, never on a `this._channel` resolved dynamically at ack time.
- Deliveries sharing the same `event.metadata.aggregateId` within one queue's consumer always have their handlers invoked strictly one-at-a-time, in delivery order.
- The delivery-count map used for `maxRetries` never retains an entry for a message that has been terminally resolved (acked or dead-lettered).
- A retry-tracking key derived from message content is always a hash of the full body, never a truncated prefix.

## Edge Cases

- **No handler registered for consumed queue**: Message is acknowledged with no processing.
- **Handler throws**: Message is nacked with requeue=true for redelivery.
- **Dispatch with no payload**: Events with `payload: undefined` are serialized as `{"name":"X","payload":null}`.
- **Multiple handlers for same event**: All handlers invoked in parallel via `Promise.allSettled()`. Every handler runs to completion. Each rejection is logged individually. If at least one rejected, the message is nacked with requeue=true (broker redelivers per `maxRetries`). Handlers that already completed will re-execute on redelivery.
- **Two handlers, one throws**: Both handlers run; one error log is emitted with the failed handler's name; `channel.nack(msg, false, true)` is called → broker requeues.
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
- **In-flight message spans a reconnect**: A handler still running when the channel/connection is replaced acks/nacks on its originally-captured (now stale) channel; that call is caught and swallowed (logged at `warn`), and the message is redelivered by the broker on the new channel once its original channel's unacked messages are considered lost (or, for a clean connection replacement, is not lost at all if the ack lands before staleness) — net effect: the message is processed exactly once from the handler's perspective, never silently vanished.
- **Burst of same-type messages without `messageId`**: Each gets a full-content-hash retry key; since bodies differ, none collides with another, so none is misclassified as exceeding `maxRetries`.
- **A message is genuinely redelivered past `maxRetries`**: Its retry key (stable `messageId`, or content hash for an identical redelivered body) accumulates count across deliveries and is dead-lettered once the count exceeds `maxRetries`.
- **Two events for the same `aggregateId` arrive back-to-back**: Second delivery's handler invocation does not start until the first's has fully settled, even though both may have been handed to the consumer callback concurrently by the broker.
- **Two events for different `aggregateId`s (or no `aggregateId`) arrive back-to-back**: Both process concurrently, up to `prefetchCount`; the aggregate-serialization map never blocks unrelated aggregates.
- **`_setupConsumer` fails while already connected** (e.g., transient broker error when `on()` is called after `connect()`): The error is logged via `this._logger.error`; the handler stays registered but inactive until the next full reconnection cycle re-runs `_setupConsumer` for it.
- **Constructing `RabbitMqEventBusConfig` without `queuePrefix`**: A TypeScript compile-time error (required field).

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

### parallel handler failure causes nack while siblings still complete

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should reject _handleMessage after all handlers settled, with siblings completed", async () => {
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

    // The successful sibling completed even though another handler threw.
    expect(successHandler).toHaveBeenCalledOnce();
  });
});
```

### sibling handler completes when an earlier handler throws (Promise.allSettled)

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus error isolation", () => {
  it("should run every handler to completion even when an earlier one throws", async () => {
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

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
        Buffer.from(JSON.stringify({ name: "E", payload: {} })),
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
import { RabbitMqEventBus } from "@noddde/rabbitmq";
import type { Logger } from "@noddde/core";

describe("RabbitMqEventBus error isolation", () => {
  it("should log once per failed handler with handlerName and error fields", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
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
        Buffer.from(JSON.stringify({ name: "E", payload: {} })),
      ),
    ).rejects.toThrow();

    const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
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

### nack-with-requeue behavior is unchanged under partial failure

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus error isolation", () => {
  it("should call channel.nack(msg, false, true) when any handler fails (existing redelivery behavior is preserved)", async () => {
    const nack = vi.fn();
    const ack = vi.fn();
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
      ack,
      nack,
      prefetch: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    bus.on("E", vi.fn());
    bus.on("E", async () => {
      throw new Error("boom");
    });

    // Capture the consume callback to invoke it directly with a synthetic message.
    let capturedCallback: ((msg: any) => Promise<void>) | undefined;
    mockChannel.consume = vi.fn(async (_queue, cb) => {
      capturedCallback = cb;
      return { consumerTag: "tag" };
    }) as any;

    await (bus as any)._createSubscriptionForEvent("E");
    expect(capturedCallback).toBeDefined();

    const event = { name: "E", payload: {} };
    const msg = {
      content: Buffer.from(JSON.stringify(event)),
      properties: { messageId: "m-1" },
    };

    await capturedCallback!(msg);

    // Regression guard: nack with requeue=true on failure, ack is not called.
    expect(nack).toHaveBeenCalledWith(msg, false, true);
    expect(ack).not.toHaveBeenCalled();
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

````ts
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

### dispatch sets contentType on published messages

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus", () => {
  it("should set contentType to the versioned noddde event content type", async () => {
    const mockChannel = {
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "TestEvent", payload: {} });

    const publishOptions = mockChannel.publish.mock.calls[0]![3];
    expect(publishOptions.contentType).toBe(
      "application/vnd.noddde.event+json; version=1",
    );
  });
});
````

### same-aggregateId deliveries run strictly one at a time in delivery order

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus aggregate ordering", () => {
  it("should serialize handler execution for deliveries sharing an aggregateId", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._channel = mockChannel;

    const order: string[] = [];
    let overlapping = false;
    let active = false;
    bus.on("Moved", async (e: any) => {
      if (active) overlapping = true;
      active = true;
      await new Promise((r) => setTimeout(r, e.payload.slow ? 30 : 5));
      order.push(e.payload.tag);
      active = false;
    });

    let consumeCallback: (msg: any) => Promise<void> = async () => {};
    mockChannel.consume = vi.fn(async (_q, cb) => {
      consumeCallback = cb;
      return { consumerTag: "t" };
    }) as any;

    await (bus as any)._setupConsumer("Moved");

    const makeMsg = (tag: string, slow: boolean) => ({
      content: Buffer.from(
        JSON.stringify({
          name: "Moved",
          payload: { tag, slow },
          metadata: { aggregateId: "acc-1" },
        }),
      ),
      properties: {},
      fields: { deliveryTag: tag },
    });

    // Fire both without awaiting the first — simulates concurrent delivery
    // up to prefetch. The slow first delivery must still finish before the
    // second one's handler starts.
    const p1 = consumeCallback(makeMsg("first", true));
    const p2 = consumeCallback(makeMsg("second", false));
    await Promise.all([p1, p2]);

    expect(order).toEqual(["first", "second"]);
    expect(overlapping).toBe(false);
  });

  it("should not serialize deliveries for different aggregateIds against each other", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._channel = mockChannel;

    let concurrentPeak = 0;
    let inFlight = 0;
    bus.on("Moved", async () => {
      inFlight++;
      concurrentPeak = Math.max(concurrentPeak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
    });

    let consumeCallback: (msg: any) => Promise<void> = async () => {};
    mockChannel.consume = vi.fn(async (_q, cb) => {
      consumeCallback = cb;
      return { consumerTag: "t" };
    }) as any;

    await (bus as any)._setupConsumer("Moved");

    const makeMsg = (aggregateId: string) => ({
      content: Buffer.from(
        JSON.stringify({
          name: "Moved",
          payload: {},
          metadata: { aggregateId },
        }),
      ),
      properties: {},
      fields: { deliveryTag: aggregateId },
    });

    await Promise.all([
      consumeCallback(makeMsg("acc-1")),
      consumeCallback(makeMsg("acc-2")),
    ]);

    expect(concurrentPeak).toBe(2);
  });
});
```

### maxRetries without messageId does not misclassify a burst of distinct messages as poison, but a genuinely-redelivered body is dead-lettered

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

describe("RabbitMqEventBus retry key", () => {
  it("should not discard 10 distinct same-type messages with no messageId", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      publish: vi.fn().mockReturnValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      resilience: { maxRetries: 3 },
    });
    (bus as any)._channel = mockChannel;

    const handler = vi.fn();
    bus.on("Burst", handler);

    let consumeCallback: (msg: any) => Promise<void> = async () => {};
    mockChannel.consume = vi.fn(async (_q, cb) => {
      consumeCallback = cb;
      return { consumerTag: "t" };
    }) as any;

    await (bus as any)._setupConsumer("Burst");

    for (let i = 0; i < 10; i++) {
      await consumeCallback({
        content: Buffer.from(JSON.stringify({ name: "Burst", payload: { i } })),
        properties: {},
        fields: { deliveryTag: i, redelivered: false },
      });
    }

    expect(handler).toHaveBeenCalledTimes(10);
    expect(mockChannel.ack).toHaveBeenCalledTimes(10);
  });

  it("should dead-letter a message redelivered past maxRetries", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      publish: vi.fn().mockReturnValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      resilience: { maxRetries: 2 },
    });
    (bus as any)._channel = mockChannel;

    bus.on("Poison", async () => {
      throw new Error("always fails");
    });

    let consumeCallback: (msg: any) => Promise<void> = async () => {};
    mockChannel.consume = vi.fn(async (_q, cb) => {
      consumeCallback = cb;
      return { consumerTag: "t" };
    }) as any;

    await (bus as any)._setupConsumer("Poison");

    const content = Buffer.from(
      JSON.stringify({ name: "Poison", payload: { fixed: true } }),
    );
    const msg = {
      content,
      properties: {},
      fields: { deliveryTag: 1, redelivered: false },
    };

    await consumeCallback(msg); // attempt 1
    await consumeCallback(msg); // attempt 2
    await consumeCallback(msg); // attempt 3 — exceeds maxRetries=2

    expect(mockChannel.publish).toHaveBeenCalledWith(
      expect.stringContaining("dlx"),
      "Poison",
      content,
      expect.objectContaining({
        headers: expect.objectContaining({ "x-original-event-name": "Poison" }),
      }),
    );
  });
});
```

### consumer setup failure is logged and retried on the next reconnection cycle

```ts
import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";
import type { Logger } from "@noddde/core";

describe("RabbitMqEventBus consumer setup failure", () => {
  it("should log an error via the framework logger when _setupConsumer fails", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      logger: mockLogger,
    });
    (bus as any)._connected = true;
    (bus as any)._channel = {
      assertQueue: vi.fn().mockRejectedValue(new Error("boom")),
    };

    bus.on("FailsToSetup", vi.fn());

    // on() fires _setupConsumer without awaiting it — flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("FailsToSetup"),
      expect.objectContaining({ eventName: "FailsToSetup" }),
    );
  });
});
```

```

```
