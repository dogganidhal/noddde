---
title: "KafkaEventBus"
module: adapters/kafka/kafka-event-bus
source_file: packages/adapters/kafka/src/kafka-event-bus.ts
status: implemented
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

> Kafka-backed EventBus implementation using `kafkajs`. Publishes domain events to Kafka topics and delivers them to registered handlers via consumer groups. Provides at-least-once delivery with ordering **only** among events sharing the same event name and the same partition key (see "Ordering Guarantees" below — this is narrower than "partition-level ordering" and does **not** cover ordering across different event names for the same aggregate). Suitable for distributed, multi-process deployments where durable event streaming is required.

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
  /**
   * Number of partitions used when a topic (event topic or DLQ topic) is
   * auto-provisioned by this bus. Default: `3`. Ignored for topics that
   * already exist (provisioning is idempotent and never alters an existing
   * topic's partition count).
   */
  topicPartitions?: number;
  /**
   * Replication factor used when a topic is auto-provisioned by this bus.
   * Default: `undefined` (broker's `default.replication.factor` applies).
   */
  replicationFactor?: number;
  /**
   * Suffix appended to a message's original topic to form its dead-letter
   * topic name (e.g., topic `"OrderPlaced"` → DLQ topic
   * `"OrderPlaced.dlq"`). Default: `".dlq"`.
   */
  dlqTopicSuffix?: string;
  /** Consumer session timeout in milliseconds (default: 30000). Increase if handlers are slow to avoid rebalances. */
  sessionTimeout?: number;
  /** Consumer heartbeat interval in milliseconds (default: 3000). Must be less than sessionTimeout / 3. */
  heartbeatInterval?: number;
  /**
   * Connection resilience configuration (default: maxAttempts=6, initialDelayMs=300, maxDelayMs=30000). Mapped to kafkajs retry options.
   * `resilience.maxRetries` governs handler-failure redelivery attempts before a message is parked to the DLQ topic (see "Dead Letter Queue" below).
   * Unlike the generic `BrokerResilience` doc ("no limit" when unset), **this adapter defaults `maxRetries` to `5` when unset** — an unbounded
   * retry count would let a single poison message retry-crash-rebalance the shared consumer forever, starving every other subscribed topic.
   */
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
2. **JSON serialization, versioned wire format** -- The full event object (`{ name, payload, metadata? }`) is serialized as JSON in the message value. This JSON-of-the-full-Event-object layout is a **versioned, stable wire contract**: every published message (including DLQ messages, see below) carries a Kafka header `content-type: application/vnd.noddde.event+json; version=1`. Consumers/tooling reading raw Kafka messages outside this bus should branch on this header rather than assuming an unversioned format. Because `JSON.stringify` is used, `Date`, `Map`, `BigInt`, and `undefined` values inside `payload` serialize lossily (a `Date` becomes an ISO string, `undefined` fields are dropped, `Map`/`BigInt` throw or serialize unexpectedly) — event payloads should be restricted to JSON-serializable values.
3. **Message key via partition key strategy** -- The message key is derived from the `partitionKeyStrategy` config option. Default strategy is `"aggregateId"`: uses `event.metadata?.aggregateId` (stringified via `String()`) when present, falls back to `null` (round-robin partition assignment). When a custom function is provided, it receives the full event and returns the key string or `null`. This ensures per-aggregate ordering **among events sharing the same event name** by default (see "Ordering Guarantees").
4. **Producer acknowledgment** -- `dispatch` awaits the producer `send()` and resolves when Kafka acknowledges receipt (at-least-once for the publish side).
5. **Dispatch before connect throws** -- Calling `dispatch` before `connect()` throws an error.
6. **Topic provisioning is connect()-time, not dispatch-time, for the common case** -- `dispatch` does not itself provision topics (see "Topic Provisioning"): the target topic is provisioned during `connect()` for every event name that has a registered `on()` handler at that point. A publish-only bus that dispatches an event name it never registered a handler for is **out of scope for auto-provisioning in this pass** and still relies on broker auto-create defaults for that specific topic — a documented, deliberate scope cut (the audited failure mode is subscriber-side: an under-partitioned topic silently defeating `partitionKeyStrategy` / consumer-group scale-out for a service that _consumes_ it).

### Ordering Guarantees

7. **Per-(event name, partition key) ordering only** -- Kafka guarantees ordering only within a single partition. Since each event name maps to its own topic (`${topicPrefix}${eventName}`, unchanged from prior versions — this is not a topology redesign) and the message key is the partition key, this bus guarantees ordering **only among events of the same name sharing the same partition key** (by default, `event.metadata?.aggregateId`). It explicitly does **not** guarantee ordering across different event names for the same aggregate: e.g. `OrderPlaced` then `OrderShipped` for the same order live on independent topics/partitions with independent consumer fetch timing and can be delivered or processed in either relative order.
8. **Consumers must be order-tolerant and idempotent** -- Any handler that observes multiple event types for one aggregate (most commonly a projection) must be written to tolerate out-of-order delivery across event names and to be idempotent under redelivery — e.g. by guarding on `event.metadata.sequenceNumber`, which `EventMetadata` already carries. This bus does not enforce or detect such guards; it is a consumer-side responsibility this spec calls out explicitly so it is not silently assumed away.

### Topic Provisioning

9. **Provisioning at connect()** -- `connect()` provisions (via `admin.createTopics`) the Kafka topic for every event name registered via `on()` before `connect()` was called, using `topicPartitions` (default `3`) partitions and `replicationFactor` (default: broker default) when set. This runs once, in a single batched `admin.createTopics` call, before the consumer subscribes — so a shared broker's default `auto.create.topics.enable` (and its usually-1-partition default) never silently caps this bus's partition count or defeats `partitionKeyStrategy` / consumer-group scale-out.
10. **Idempotent, additive provisioning** -- Provisioning a topic that already exists is a no-op (kafkajs's `createTopics` does not alter an existing topic's partition count or error). Each topic is provisioned at most once per bus instance lifetime (tracked in-memory); repeated `dispatch()` calls to the same topic, or `on()` registrations sharing a topic, do not trigger repeated admin round-trips.
11. **DLQ topics are provisioned lazily, on first use** -- A message's DLQ topic (see "Dead Letter Queue") is provisioned the first time a message for that topic needs to be parked, not eagerly at `connect()` (most topics never produce a DLQ message).
12. **Publish-only topics are a documented scope cut** -- An event name that is only ever `dispatch()`-ed and never has an `on()` handler registered on this bus is not auto-provisioned by this bus; it relies on the broker's own topic auto-create/manual-provisioning. This is a deliberate, narrower scope than "every topic this bus ever touches" — see item 6.

### Subscription / Handler Registration

12. **on registers handlers by event name** -- `on(eventName, handler)` stores the handler in an internal registry keyed by event name. Multiple handlers per event name are supported (fan-out within the same process).
13. **Consumer subscription** -- When `connect()` is called, the consumer subscribes to the topic `${topicPrefix}${eventName}` for each registered event name. Registering an additional handler via `on()` once `connect()` has started is supported **only** for an event name whose topic is already subscribed (this simply appends another handler for in-process fan-out). Calling `on()` for an event name whose topic is **not** already subscribed **throws** an `Error` once `connect()` has started — this covers both the fully-connected state **and** the in-progress state (`connect()` awaited but not yet resolved), because `connect()` subscribes only the topics known when it runs its subscribe loop, so an `on()` that races an in-flight `connect()` could register a handler that never gets a subscription. kafkajs also forbids subscribing to a new topic on a running consumer (`Cannot subscribe to topic while consumer is running`). The thrown message instructs the caller to register all handlers before `connect()`. The adapter does **not** attempt (and does not pretend) to subscribe late: there is no silent-loss path and no misleading "will be retried" log.
14. **Message deserialization with poison message protection** -- Incoming Kafka messages are deserialized from JSON. Deserialization is wrapped in try/catch. If `JSON.parse` throws (malformed message): the error is logged; when the message's topic/partition/offset location is known (real consumer delivery), the raw message is best-effort parked to the DLQ topic (see "Dead Letter Queue") with a "deserialize failed" reason before the offset is committed; when location is unavailable (e.g. a direct unit-test call to `_handleMessage` with only 2 arguments), the message is simply skipped as before. Poison messages never block the partition via infinite redelivery — they are never retried, since a re-fetch of the same bytes can never parse successfully.
15. **Isolated parallel handler invocation** -- Handlers for the same event are invoked concurrently via `Promise.allSettled()` (not `Promise.all()`). This guarantees that **every registered handler runs to completion** even when some of them fail — siblings are never silenced or short-circuited by an earlier rejection. After all handlers settle, the bus iterates the rejected results and logs each one individually via the framework `Logger` at `error` level with structured fields (see "Per-handler error logging" below). This differs from `EventEmitterEventBus` (which invokes sequentially within a single process) because broker adapters operate in distributed contexts where independent handlers (projections, sagas) should not block each other.

    If at least one handler rejected and the message's topic/partition/offset location is known (real consumer delivery — see "Dead Letter Queue" and item 22 for the bounded-retry-then-park behavior this enables), the bus does **not** always re-throw: below the retry cap it re-throws (skipping the offset commit, same as before); once the cap is exceeded it parks the message to the DLQ and returns normally so the offset commits and consumption proceeds to the next message. When location is unknown (direct unit-test calls without the 3rd argument), the legacy contract is preserved unconditionally: the first rejection is always re-thrown immediately, with no cap and no DLQ involvement.

    **Per-handler error logging** -- For each rejected handler, the bus calls `logger.error(message, fields)` exactly once with:

    - `eventName: string` — from `event.name`.
    - `eventId?: string` — from `event.metadata?.eventId` when present.
    - `handlerName: string` — read from the handler's `name` property; falls back to `event.name` when anonymous.
    - `error: { name, message, stack? }` — extracted from the caught exception. Non-`Error` rejection values are coerced via `String(value)` into `message`.
    - `traceId?: string` and `spanId?: string` — populated from the active OpenTelemetry span via the configured `Instrumentation` instance. Absent when no span is active or when `@opentelemetry/api` is not installed.

16. **Explicit offset commit after handlers** -- The consumer is configured with `autoCommit: false` in `consumer.run()`. The offset is committed explicitly via `consumer.commitOffsets([{ topic, partition, offset: nextOffset }])` (where `nextOffset` is `message.offset + 1`, as a string) once `_handleMessage` resolves without throwing — either because every handler succeeded, or because a failing message was parked to the DLQ (see item 15). This provides at-least-once delivery for a message still in its retry window, and "processed exactly once more, successfully or parked" for a message that has exhausted retries. Without explicit `commitOffsets()`, offsets are never persisted to Kafka and every consumer restart would reprocess all messages. After committing, the delivery count entry for this offset is pruned from the `_deliveryCounts` map to prevent unbounded memory growth.

### Dead Letter Queue

17. **DLQ destination** -- Each Kafka topic has an associated dead-letter topic named `${topic}${dlqTopicSuffix}` (default suffix `.dlq`, configurable). The DLQ topic is provisioned (see "Topic Provisioning") the first time a message needs to be parked to it.
18. **Bounded retries before parking** -- When a message's handler(s) fail, delivery attempts for that exact offset are counted in-memory (`_deliveryCounts`, keyed by `topic:partition:offset`). The cap is `resilience.maxRetries` when configured, otherwise a built-in default of `5` (this adapter intentionally does **not** inherit the generic "unset = infinite redelivery" default described on `BrokerResilience`, because unbounded redelivery of a failing message is exactly the head-of-line-blocking failure mode this DLQ mechanism exists to prevent). While the attempt count is at or below the cap, the existing behavior applies: the message is re-thrown and redelivered. Once the count exceeds the cap, the message is parked instead of re-thrown.
19. **DLQ message contents** -- The parked message published to the DLQ topic carries the **original, unmodified message value** (the same raw bytes that failed to process) plus Kafka headers carrying failure metadata: `content-type` (same versioned content-type as any other published message), `x-noddde-dlq-error` (the failure's message string), `x-noddde-dlq-attempts` (the number of delivery attempts made, as a string), `x-noddde-dlq-original-topic`, `x-noddde-dlq-original-partition`, `x-noddde-dlq-original-offset` (the message's original coordinates, so an operator can correlate it back to the source topic), and `x-noddde-dlq-timestamp` (ISO-8601, when the message was parked). A `logger.error` call is also emitted at the moment of parking with the same fields. This lets operators inspect and replay the exact failed payload rather than losing it to a bare warning log.
20. **Parking is best-effort but never silent** -- If the DLQ publish itself fails (e.g. broker unreachable), the bus logs the DLQ failure and falls back to the pre-DLQ behavior for that attempt: re-throw the original rejection so the offset is not committed and Kafka redelivers. The message is never silently dropped by a DLQ-publish failure — worst case it continues retrying (and re-attempting to park) like before this feature existed.
21. **maxRetries delivery limit is unified with the DLQ cap** -- There is a single delivery-attempt counter and a single cap (see item 18); there is no separate, lower-level "skip without parking" path — the old behavior of silently discarding an exhausted-retries message (logging a warning and committing the offset with the payload gone) no longer exists. Every exhausted-retries message is parked, not just logged.

### Backpressure

22. **Session timeout and heartbeat configuration** -- `connect()` passes `sessionTimeout` and `heartbeatInterval` to the kafkajs consumer constructor. Defaults: 30000ms session timeout, 3000ms heartbeat interval. This prevents consumer rebalances when handlers are slow.
23. **Bounded retry limits the blast radius of a single bad message across topics** -- Because a single shared kafkajs consumer serves every subscribed topic (`consumer.run()` is called once, with one `eachMessage` callback), a message that keeps getting re-thrown out of `eachMessage` causes kafkajs's own retry/crash/rebalance cycle, which stalls fetch progress for **every** subscribed topic, not just the failing one — this bus does not achieve true per-partition isolation (that would require `eachBatch` with per-partition concurrency, out of scope for this pass). The DLQ cap (item 18) bounds this blast radius: instead of an indefinitely failing message causing indefinite crash/rebalance churn across all topics, at most `maxRetries` (default `5`) rounds of it occur before the message is parked and consumption of **all** topics — including the one that was failing — proceeds normally again.

### Connection Lifecycle

24. **connect establishes producer and consumer** -- `connect()` creates and connects the Kafka producer and consumer. The `resilience` config option (if provided) is mapped to kafkajs retry options: `maxAttempts-1` → `retries`, `initialDelayMs` → `initialRetryTime`, `maxDelayMs` → `maxRetryTime`. These are passed to the `new Kafka()` constructor. kafkajs handles reconnection natively.
25. **connect is idempotent and concurrent-safe** -- Calling `connect()` when already connected is a no-op. Concurrent `connect()` calls are deduplicated via a connection promise mutex — the second call awaits the first rather than starting a parallel connection attempt.
26. **close disconnects cleanly** -- `close()` first calls `consumer.stop()` to halt message processing and allow in-flight handlers to complete, then disconnects the producer and consumer, and clears the handler registry. After `close()`, dispatch and on throw. The `stop()` → `disconnect()` sequence prevents unhandled promise rejections from in-flight handlers.
27. **close is idempotent** -- Calling `close()` multiple times has no additional effect.

### Error Handling

28. **Handler errors propagate as message-level failure (until the retry cap)** -- After `Promise.allSettled` settles every registered handler and each rejection has been logged individually, `_handleMessage` re-throws the first rejected handler's reason **unless** the retry cap has just been exceeded, in which case it parks to the DLQ and resolves instead (see "Dead Letter Queue"). When it re-throws, the outer consumer loop catches this and skips the offset commit, enabling Kafka redelivery. All sibling handlers ran to completion before any re-throw — none are silenced by an earlier rejection.
29. **Serialization errors on dispatch** -- If event serialization fails, `dispatch` rejects with the serialization error.
30. **Connection errors on dispatch** -- If the broker is unreachable during `dispatch`, the promise rejects with a connection error.

### Logging

31. **Framework logger** -- All internal logging uses the `Logger` interface from `@noddde/core`. The logger is resolved from `config.logger` or defaults to `new NodddeLogger("warn", "noddde:kafka")` from `@noddde/engine`. All log calls pass structured context data as the second parameter (e.g., `{ eventName }`, `{ topic }`, `{ error: String(err) }`). No `console.log`, `console.warn`, or `console.error` calls exist in the implementation.

### Warmup

32. **Explicit warmup round-trip** -- `warmup()` addresses broker-side cold-start latency that `connect()`'s `FETCH_START` wait does not cover (a freshly-deployed cluster's first end-to-end publish/consume cycle can take far longer than subsequent ones). It uses a uniquely-named internal topic (derived from `clientId`) and repeatedly dispatches a throwaway event to that topic (on a 1-second interval) until an internal handler observes it. `warmup()` must be called after `connect()`; calling it before `connect()` or after `close()` throws the same "not connected" error as `dispatch()`.
33. **Idempotent** -- After the first successful `warmup()` call, subsequent calls resolve immediately without repeating the round-trip. Concurrent overlapping calls are deduplicated via an in-flight promise mutex, mirroring `connect()`'s dedup pattern — the second caller awaits the first rather than starting a parallel round-trip.
34. **warmupOnConnect config** -- When `warmupOnConnect: true`, the warmup topic is created and its subscription registered _before_ `consumer.run()` starts during `connect()` (kafkajs forbids subscribing to a new topic once the consumer is running), and `connect()` then calls `warmup()` internally before its own returned promise resolves — so callers that opt in get a fully warmed bus from a single `await connect()`.
35. **Warmup timeout** -- If the round-trip doesn't complete within `warmupTimeoutMs` (default `60000`), `warmup()` rejects with a timeout error rather than hanging indefinitely.
36. **Late warmup() without warmupOnConnect** -- If `warmup()` is called explicitly after `connect()` resolved without `warmupOnConnect` configured, the warmup topic's subscription was not set up before `consumer.run()` started. Since kafkajs forbids subscribing while the consumer is running, `warmup()` handles this by stopping the consumer (`consumer.stop()`), provisioning the warmup topic and subscription, and restarting the fetch loop (`consumer.run()` again) before performing the round-trip. This is scoped only to the warmup topic — it does not fix late `on()` registration for other event names (see robustness §3.4, out of scope here).

## Invariants

- All dispatched events are serialized as JSON (must be JSON-serializable).
- Every published message (event topics and DLQ topics alike) carries the `content-type: application/vnd.noddde.event+json; version=1` header.
- Handlers registered via `on()` receive the full `Event` object.
- Offset commits happen only after `_handleMessage` resolves without throwing — every handler succeeded, or a failing message was parked to the DLQ.
- All registered handlers for an event delivery run to completion, even when some fail (per-handler isolation via `Promise.allSettled`).
- Each handler failure produces exactly one `logger.error` call with structured fields.
- The bus does not deduplicate events (same event dispatched twice = two deliveries).
- Topic names follow the pattern `${topicPrefix}${eventName}` — unchanged; this bus routes per event name, not per aggregate type.
- Message key defaults to `event.metadata?.aggregateId` (stringified) for ordering **among same-named events sharing that key** — not across event names (see "Ordering Guarantees").
- Every event topic with a registered `on()` handler, and every DLQ topic actually used, is provisioned via `admin.createTopics` (idempotently, at most once per bus instance) rather than left to broker auto-create defaults. Publish-only topics with no registered handler are a documented exception (see Topic Provisioning item 12).
- A message that exhausts its retry cap (`resilience.maxRetries`, default `5`) is parked to `${topic}${dlqTopicSuffix}` with failure metadata headers — never silently discarded.
- No `console.*` calls exist in the implementation — all logging goes through the `Logger` interface.
- `warmup()` performs at most one real round-trip per bus instance; repeat calls after success are no-ops.

## Edge Cases

- **No handler registered for a consumed topic**: Message is acknowledged (committed) with no processing.
- **Handler throws, retry cap not yet exceeded**: Offset is not committed, message will be redelivered on next poll.
- **Handler throws repeatedly past the retry cap**: The message is parked to the DLQ topic with failure metadata headers, then the offset commits and consumption proceeds to the next message — it is not redelivered again and is not silently dropped.
- **DLQ publish itself fails**: The bus logs the DLQ failure and re-throws the original handler rejection, falling back to normal (uncapped-for-this-attempt) redelivery rather than losing the message.
- **Dispatch to an event name with a registered `on()` handler**: The topic was already provisioned during `connect()` (via `admin.createTopics`, `topicPartitions` partitions) — `dispatch()` itself does no provisioning work.
- **Dispatch to an event name with no registered handler on this bus (publish-only)**: Not auto-provisioned by this bus (documented scope cut); relies on broker auto-create defaults for that topic.
- **Dispatch with no payload**: Events with `payload: undefined` are serialized as `{"name":"X","payload":null}`.
- **Dispatch with a non-JSON-serializable payload value** (`Date`, `Map`, `BigInt`, `undefined` field): Serializes lossily per `JSON.stringify` semantics (e.g. `Date` → ISO string, `undefined` fields dropped) — documented as a caveat of the versioned wire format, not validated or rejected by the bus.
- **Multiple handlers for same event**: All handlers are invoked in parallel via `Promise.allSettled()`. Every handler runs to completion. Each rejection is logged individually. If at least one rejected and the retry cap isn't exceeded, the offset is not committed (enabling redelivery). Handlers that already completed will re-execute on redelivery.
- **Two handlers, one throws**: Both handlers run; one error log is emitted with the failed handler's name; offset is not committed → broker redelivers (until the retry cap, then DLQ).
- **A message on one topic keeps failing**: Bounded by the retry cap (default `5`), after which it is parked and consumption of that topic — and every other topic sharing the consumer — proceeds; see Backpressure item 23 for why full per-message-only isolation isn't achieved without `eachBatch`.
- **on() called before connect()**: Handlers are buffered; subscriptions happen when `connect()` is called.
- **on() called after connect() (or while connect() is in progress) for a new topic**: Throws an `Error` — kafkajs cannot subscribe to a new topic on a running consumer, and a handler registered after `connect()`'s subscribe loop would never get a subscription, so its events would be silently lost. The caller must register all handlers before `connect()`.
- **on() called after connect() for an already-subscribed topic**: Allowed. Appends an additional handler for that event name (in-process fan-out); no new subscribe is issued.
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
- **warmup() called explicitly without warmupOnConnect**: The warmup topic wasn't subscribed before `consumer.run()` started during `connect()`, so `warmup()` stops the consumer, provisions the topic and subscription, and restarts the fetch loop before performing the round-trip — verified against a real broker, not just mocks.
- **Malformed (unparseable) message with a known topic/partition/offset**: Parked to the DLQ (best-effort) with a "deserialize failed" reason, then the offset commits. With no location (direct 2-arg `_handleMessage` test call), the message is just skipped as before.

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

### connect() provisions topics for registered handlers

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus topic provisioning", () => {
  it("should provision the topic for every event registered before connect(), using topicPartitions", async () => {
    const mockAdmin = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      createTopics: vi.fn().mockResolvedValue(true),
    };
    const mockKafka = {
      producer: () => ({
        send: vi.fn().mockResolvedValue(undefined),
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
      }),
      consumer: () => ({
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        events: { FETCH_START: "consumer.fetch_start" },
        on: vi.fn().mockImplementation((_e, cb) => {
          cb();
          return () => {};
        }),
      }),
      admin: () => mockAdmin,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      topicPartitions: 7,
    });
    (bus as any)._kafka = mockKafka;

    bus.on("AccountCreated", vi.fn());
    bus.on("OrderPlaced", vi.fn());
    await bus.connect();

    expect(mockAdmin.createTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        waitForLeaders: true,
        topics: expect.arrayContaining([
          { topic: "AccountCreated", numPartitions: 7 },
          { topic: "OrderPlaced", numPartitions: 7 },
        ]),
      }),
    );
  });
});
```

### wire format carries a versioned content-type header

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus wire format", () => {
  it("should publish every dispatched message with the versioned content-type header", async () => {
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
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    await bus.connect();
    await bus.dispatch({ name: "AccountCreated", payload: { id: "acc-1" } });

    expect(mockProducer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            headers: {
              "content-type": "application/vnd.noddde.event+json; version=1",
            },
          }),
        ],
      }),
    );
  });
});
```

### dead-letter queue parks a message once the retry cap is exceeded

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus dead letter queue", () => {
  it("should park a message to its DLQ topic once the retry cap is exceeded, then allow the offset to commit", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockAdmin = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      createTopics: vi.fn().mockResolvedValue(true),
    };
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      resilience: { maxRetries: 2 },
    });
    (bus as any)._kafka = {
      producer: () => mockProducer,
      consumer: () => ({
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        events: { FETCH_START: "consumer.fetch_start" },
        on: vi.fn().mockImplementation((_e, cb) => {
          cb();
          return () => {};
        }),
      }),
      admin: () => mockAdmin,
    };

    bus.on("E", async () => {
      throw new Error("boom");
    });
    await bus.connect();

    const rawValue = JSON.stringify({ name: "E", payload: { n: 1 } });
    const location = { topic: "E", partition: 0, offset: "10" };

    await expect(
      (bus as any)._handleMessage("E", rawValue, location),
    ).rejects.toThrow("boom");
    await expect(
      (bus as any)._handleMessage("E", rawValue, location),
    ).rejects.toThrow("boom");

    // Attempt 3 exceeds the cap of 2: parked, resolves instead of throwing.
    await expect(
      (bus as any)._handleMessage("E", rawValue, location),
    ).resolves.toBeUndefined();

    expect(mockProducer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "E.dlq",
        messages: [
          expect.objectContaining({
            value: rawValue,
            headers: expect.objectContaining({
              "x-noddde-dlq-error": "boom",
              "x-noddde-dlq-attempts": "3",
              "x-noddde-dlq-original-topic": "E",
              "x-noddde-dlq-original-partition": "0",
              "x-noddde-dlq-original-offset": "10",
            }),
          }),
        ],
      }),
    );
  });
});
```

### a failing message on one topic does not block another topic's progress

```ts
import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

describe("KafkaEventBus cross-topic isolation", () => {
  it("should let topic B keep making progress after topic A's message exhausts retries and is parked", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockAdmin = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      createTopics: vi.fn().mockResolvedValue(true),
    };
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      resilience: { maxRetries: 0 },
    });
    (bus as any)._kafka = {
      producer: () => mockProducer,
      consumer: () => ({
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        events: { FETCH_START: "consumer.fetch_start" },
        on: vi.fn().mockImplementation((_e, cb) => {
          cb();
          return () => {};
        }),
      }),
      admin: () => mockAdmin,
    };

    const topicBReceived: unknown[] = [];
    bus.on("TopicA", async () => {
      throw new Error("always fails");
    });
    bus.on("TopicB", async (event) => {
      topicBReceived.push(event.payload);
    });
    await bus.connect();

    // Exhausts its (zero) retry budget on the first attempt and is parked —
    // _handleMessage resolves rather than throwing.
    await expect(
      (bus as any)._handleMessage(
        "TopicA",
        JSON.stringify({ name: "TopicA", payload: {} }),
        { topic: "TopicA", partition: 0, offset: "0" },
      ),
    ).resolves.toBeUndefined();

    for (let i = 0; i < 3; i++) {
      await (bus as any)._handleMessage(
        "TopicB",
        JSON.stringify({ name: "TopicB", payload: { n: i } }),
        { topic: "TopicB", partition: 0, offset: String(i) },
      );
    }

    expect(topicBReceived).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
  });
});
```
