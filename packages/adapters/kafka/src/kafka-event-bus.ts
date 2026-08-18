import { Kafka, type Producer, type Consumer } from "kafkajs";
import type {
  AsyncEventHandler,
  BrokerResilience,
  Connectable,
  EventBus,
  Logger,
} from "@noddde/core";
import type { Event, Instrumentation } from "@noddde/core";
import { NoopInstrumentation } from "@noddde/core";
import { NodddeLogger } from "@noddde/engine";

/**
 * Configuration for the KafkaEventBus.
 */
export interface KafkaEventBusConfig {
  /** Kafka broker addresses (e.g., ["localhost:9092"]). */
  brokers: string[];
  /** Client identifier for this Kafka client instance. */
  clientId: string;
  /** Consumer group ID. Events fan out across different group IDs. */
  groupId: string;
  /**
   * Optional prefix prepended to event names to form topic names.
   * For example, "noddde." → "noddde.AccountCreated".
   */
  topicPrefix?: string;
  /**
   * Number of partitions used when a topic (event topic or DLQ topic) is
   * auto-provisioned by this bus. Default: 3. Ignored for topics that
   * already exist.
   */
  topicPartitions?: number;
  /**
   * Replication factor used when a topic is auto-provisioned by this bus.
   * Default: undefined (broker's default.replication.factor applies).
   */
  replicationFactor?: number;
  /**
   * Suffix appended to a message's original topic to form its dead-letter
   * topic name (e.g. "OrderPlaced" -> "OrderPlaced.dlq"). Default: ".dlq".
   */
  dlqTopicSuffix?: string;
  /** Consumer session timeout in milliseconds (default: 30000). Increase if handlers are slow to avoid rebalances. */
  sessionTimeout?: number;
  /** Consumer heartbeat interval in milliseconds (default: 3000). Must be less than sessionTimeout / 3. */
  heartbeatInterval?: number;
  /**
   * Connection resilience configuration (default: maxAttempts=6, initialDelayMs=300, maxDelayMs=30000). Mapped to kafkajs retry options.
   * `resilience.maxRetries` governs handler-failure redelivery attempts before a message is parked to the DLQ topic. Unlike the generic
   * BrokerResilience doc ("no limit" when unset), this adapter defaults `maxRetries` to `5` when unset, to bound how long a poison message
   * can crash/rebalance the shared consumer before being parked.
   */
  resilience?: BrokerResilience;
  /**
   * Strategy for deriving the Kafka message key from an event.
   * - `"aggregateId"` (default): uses `event.metadata?.aggregateId` (stringified). Falls back to `null` (round-robin).
   * - Function: custom strategy receiving the event, returning the key string or `null`.
   */
  // eslint-disable-next-line no-unused-vars
  partitionKeyStrategy?: "aggregateId" | ((event: Event) => string | null);
  /** Framework logger instance. Defaults to NodddeLogger("warn", "noddde:kafka") from @noddde/engine. */
  logger?: Logger;
  /**
   * OpenTelemetry instrumentation used to enrich per-handler error logs with
   * `traceId`/`spanId` correlation fields. Defaults to a no-op instance.
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

/** Content-type header value applied to every message this bus publishes (event topics and DLQ topics alike). */
const WIRE_CONTENT_TYPE = "application/vnd.noddde.event+json; version=1";

/**
 * Default cap on handler-failure delivery attempts before a message is
 * parked to its DLQ topic, used when `resilience.maxRetries` is not
 * configured. Deliberately finite (unlike the generic BrokerResilience
 * "unset = infinite redelivery" default) so a single poison message can
 * never crash/rebalance the shared consumer forever.
 */
const DEFAULT_MAX_RETRIES = 5;

/**
 * Kafka-backed EventBus implementation using `kafkajs`.
 *
 * Publishes domain events to Kafka topics and delivers them to registered
 * handlers via consumer groups. Provides at-least-once delivery with
 * ordering only among events sharing the same event name and partition key
 * (see the spec's "Ordering Guarantees" section) — NOT across different
 * event names for the same aggregate. Consumers of multiple event types for
 * one aggregate must be order-tolerant and idempotent.
 *
 * Usage:
 * 1. Construct the bus with config.
 * 2. Call `connect()` to establish producer/consumer connections.
 * 3. Call `on()` to register event handlers.
 * 4. Call `dispatch()` to publish events.
 * 5. Call `close()` on shutdown to release resources.
 */
export class KafkaEventBus implements EventBus, Connectable {
  private readonly _config: KafkaEventBusConfig;
  private readonly _logger: Logger;
  private readonly _instrumentation: Instrumentation;
  /** The kafkajs Kafka client. Exposed as a field so tests can inject a mock. */
  private _kafka: Pick<Kafka, "producer" | "consumer" | "admin">;
  private _producer: Producer | null = null;
  private _consumer: Consumer | null = null;
  private _connected = false;
  private _closed = false;
  /**
   * In-flight connection promise used to deduplicate concurrent `connect()` calls.
   * Set at the start of connection, cleared in a finally block when done.
   */
  private _connecting: Promise<void> | null = null;
  /** `true` once a `warmup()` round-trip has completed successfully. */
  private _warmedUp = false;
  /**
   * In-flight warmup promise used to deduplicate concurrent `warmup()` calls.
   * Set at the start of the round-trip, cleared in a finally block when done.
   */
  private _warmingUp: Promise<void> | null = null;
  /**
   * Synthetic event name for the internal warmup topic, derived from
   * `clientId` so each bus instance gets its own dedicated topic.
   */
  private readonly _warmupEventName: string;
  /**
   * Resolvers for in-flight `_performWarmupRoundTrip()` calls, invoked by
   * the persistent internal warmup handler (registered once, during
   * `connect()`) whenever a warmup message is observed.
   */
  private readonly _warmupWaiters: Set<() => void> = new Set();
  /** Internal handler registry keyed by event name. */
  private readonly _handlers: Map<string, AsyncEventHandler[]> = new Map();
  /** Topics that have already been subscribed to (avoids duplicate subscribes). */
  private readonly _subscribedTopics: Set<string> = new Set();
  /**
   * In-memory delivery attempt counter keyed by message offset string.
   * Used to enforce `resilience.maxRetries` without requiring header propagation.
   * Entries are never purged — suitable for short-lived consumer sessions.
   */
  private readonly _deliveryCounts: Map<string, number> = new Map();
  /** Topics (event topics and DLQ topics) already provisioned via `admin.createTopics` by this bus instance. */
  private readonly _provisionedTopics: Set<string> = new Set();

  constructor(config: KafkaEventBusConfig) {
    this._config = config;
    this._logger = config.logger ?? new NodddeLogger("warn", "noddde:kafka");
    this._instrumentation = config.instrumentation ?? new NoopInstrumentation();
    this._warmupEventName = `__noddde_warmup_${config.clientId}`;
    this._kafka = new Kafka({
      brokers: config.brokers,
      clientId: config.clientId,
      ...(config.resilience && {
        retry: {
          ...(config.resilience.maxAttempts !== undefined && {
            retries: config.resilience.maxAttempts - 1,
          }),
          ...(config.resilience.initialDelayMs !== undefined && {
            initialRetryTime: config.resilience.initialDelayMs,
          }),
          ...(config.resilience.maxDelayMs !== undefined && {
            maxRetryTime: config.resilience.maxDelayMs,
          }),
        },
      }),
    });
  }

  /**
   * Establishes producer and consumer connections to the Kafka cluster.
   * Must be called before `dispatch()` or `on()` (when `on()` needs to subscribe).
   * Idempotent: calling when already connected is a no-op.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      return;
    }

    // Deduplicate concurrent connect() calls: if a connection is already in
    // progress, await that promise rather than starting a parallel attempt.
    if (this._connecting != null) {
      return this._connecting;
    }

    const connecting = (async () => {
      try {
        this._producer = this._kafka.producer();
        this._consumer = this._kafka.consumer({
          groupId: this._config.groupId,
          sessionTimeout: this._config.sessionTimeout ?? 30000,
          heartbeatInterval: this._config.heartbeatInterval ?? 3000,
          // kafkajs only auto-restarts a crashed consumer.run() loop when the
          // crash error is `retriable` (see `_markRetriable`); this override
          // makes sure restart actually happens once it is.
          retry: { restartOnFailure: () => Promise.resolve(true) },
        });

        await this._producer.connect();
        await this._consumer.connect();

        // Provision the warmup topic and its internal handler *before*
        // consumer.run() starts, so the round-trip works the moment
        // connect() resolves — kafkajs forbids subscribing to a new topic
        // once the consumer is running ("Cannot subscribe to topic while
        // consumer is running"). Only done eagerly for warmupOnConnect;
        // an explicit warmup() call without it provisions lazily via the
        // stop/subscribe/restart path in warmup() itself.
        if (this._config.warmupOnConnect) {
          await this._provisionWarmupTopic();
        }

        // Provision (idempotently) the Kafka topic for every event name
        // registered via on() before connect() — one batched admin call —
        // so a shared broker's auto-create defaults (usually 1 partition)
        // never silently cap this bus's partition count or defeat
        // partitionKeyStrategy / consumer-group scale-out. The warmup topic
        // is provisioned separately above, via _provisionWarmupTopic().
        await this._provisionTopics(
          [...this._handlers.keys()]
            .filter((name) => name !== this._warmupEventName)
            .map((name) => this._topicName(name)),
        );

        // Subscribe to topics for all handlers registered before connect
        // (including the warmup handler registered just above, if provisioned).
        for (const eventName of this._handlers.keys()) {
          const topic = this._topicName(eventName);
          if (!this._subscribedTopics.has(topic)) {
            await this._consumer!.subscribe({ topic, fromBeginning: false });
            this._subscribedTopics.add(topic);
          }
        }

        await this._runConsumerLoop();

        this._connected = true;

        // Opt-in cold-start mitigation: run the warmup round-trip before
        // connect()'s returned promise resolves, so a failure propagates
        // through connect() just like any other connection error.
        if (this._config.warmupOnConnect) {
          await this.warmup();
        }
      } finally {
        this._connecting = null;
      }
    })();

    this._connecting = connecting;
    return connecting;
  }

  /**
   * Creates the internal warmup topic via the admin client and registers
   * the persistent internal handler that resolves in-flight
   * `_performWarmupRoundTrip()` waiters. Does NOT subscribe — the caller
   * is responsible for adding the topic to `_subscribedTopics` (either via
   * `connect()`'s pre-run subscribe loop, or `warmup()`'s lazy
   * stop/subscribe/restart path).
   */
  private async _provisionWarmupTopic(): Promise<void> {
    const warmupTopic = this._topicName(this._warmupEventName);
    const admin = this._kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: [{ topic: warmupTopic, numPartitions: 1 }],
      });
    } finally {
      await admin.disconnect();
    }
    this._provisionedTopics.add(warmupTopic);
    // Append rather than overwrite, consistent with on()'s registry
    // semantics — a collision with a user-registered handler for this
    // (extremely unlikely) synthetic event name must not silently drop it.
    const existingHandlers = this._handlers.get(this._warmupEventName) ?? [];
    this._handlers.set(this._warmupEventName, [
      ...existingHandlers,
      async () => {
        for (const resolveWaiter of this._warmupWaiters) {
          resolveWaiter();
        }
      },
    ]);
  }

  /**
   * Idempotently provisions the given topics via the admin client, using
   * `topicPartitions` (default 3) partitions and `replicationFactor` when
   * configured. Topics already provisioned by this bus instance (tracked in
   * `_provisionedTopics`) are skipped — kafkajs's `createTopics` is itself
   * idempotent (a no-op for an existing topic, it never alters its
   * partition count), but batching the admin round-trip only for genuinely
   * new topics keeps repeated calls (e.g. from `dispatch()`) cheap.
   */
  private async _provisionTopics(topics: string[]): Promise<void> {
    const pending = topics.filter((t) => !this._provisionedTopics.has(t));
    if (pending.length === 0) {
      return;
    }

    const admin = this._kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: pending.map((topic) => ({
          topic,
          numPartitions: this._config.topicPartitions ?? 3,
          ...(this._config.replicationFactor !== undefined && {
            replicationFactor: this._config.replicationFactor,
          }),
        })),
      });
    } finally {
      await admin.disconnect();
    }

    for (const topic of pending) {
      this._provisionedTopics.add(topic);
    }
  }

  /**
   * Starts (or restarts) the consumer's fetch loop via `consumer.run()`,
   * and waits for the `FETCH_START` event before resolving so that
   * publishes issued right after this call are guaranteed to be seen by
   * the consumer (see the long-form rationale below).
   *
   * Without this wait, `consumer.run()` returns immediately and the caller
   * can dispatch a message *before* the consumer's initial offset fetch
   * completes — with the default `fromBeginning: false`, that first
   * message gets skipped because the offset reset happens after it was
   * published.
   *
   * We listen for the kafkajs `FETCH_START` event rather than
   * `GROUP_JOIN`: `GROUP_JOIN` fires after partition assignment, but
   * before the consumer's initial offset fetch lands, so a message
   * published right after `GROUP_JOIN` can still end up below the
   * consumer's eventual starting position. `FETCH_START` only fires once
   * the consumer is actually polling, which is the moment we can
   * guarantee subsequent publishes will be delivered.
   */
  private async _runConsumerLoop(): Promise<void> {
    const consumer = this._consumer!;

    let fetchStarted!: () => void;
    const fetchStartedPromise = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    const unsubscribe = consumer.on(consumer.events.FETCH_START, () =>
      fetchStarted(),
    );

    await consumer.run({
      // Disable auto-commit so offsets are only committed after all handlers
      // complete successfully (at-least-once delivery guarantee).
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        const rawValue = message.value?.toString();
        if (rawValue == null) {
          return;
        }
        // Derive event name from topic by stripping the prefix
        const prefix = this._config.topicPrefix ?? "";
        const eventName = topic.startsWith(prefix)
          ? topic.slice(prefix.length)
          : topic;
        const offsetKey = `${topic}:${partition}:${message.offset}`;
        await this._handleMessage(eventName, rawValue, {
          topic,
          partition,
          offset: message.offset,
        });

        // Explicitly commit the offset after all handlers succeeded.
        // Without this, kafkajs never persists offsets when autoCommit is false.
        await consumer.commitOffsets([
          {
            topic,
            partition,
            offset: (BigInt(message.offset) + 1n).toString(),
          },
        ]);

        // Prune the delivery-count entry to prevent unbounded memory growth.
        this._deliveryCounts.delete(offsetKey);
      },
    });

    // If we subscribed to any topic, wait for the consumer to start
    // fetching. With no subscribed topics there's nothing to wait for —
    // kafkajs won't emit FETCH_START at all. Cap at 30s so a
    // misconfigured broker doesn't hang the process forever.
    if (this._subscribedTopics.size > 0) {
      await Promise.race([
        fetchStartedPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
      ]);
    }
    unsubscribe();
  }

  /**
   * Registers a handler for a given event name.
   * Subscribes the consumer to the corresponding Kafka topic.
   * Multiple handlers per event name are supported (fan-out within the same process).
   *
   * Handlers registered before `connect()` are buffered and subscriptions are
   * established when `connect()` is called.
   *
   * Registering an additional handler for an event whose topic is already
   * subscribed is allowed at any time (in-process fan-out). However, calling
   * `on()` once `connect()` has started (whether it has resolved or is still
   * in progress) for an event whose topic is **not** yet subscribed throws:
   * kafkajs forbids subscribing to a new topic on a running consumer
   * (`Cannot subscribe to topic while consumer is running`), so the
   * subscription cannot take effect and the messages would be silently lost.
   * Register all handlers before `connect()`.
   *
   * @throws If called after `close()`.
   * @throws If called after `connect()` has started for an event whose topic
   *   is not already subscribed.
   */
  on(eventName: string, handler: AsyncEventHandler): void {
    if (this._closed) {
      throw new Error("KafkaEventBus is closed");
    }

    // Once connect() has started, a new topic subscription can't be added to
    // the consumer. We must guard on `_connecting` too, not just `_connected`:
    // connect() subscribes the topics known at the moment it runs its
    // subscribe loop, so an on() that races an in-flight connect() could
    // register a handler *after* that loop and never get a subscription. Fail
    // loudly in both states. Adding another handler for an already-subscribed
    // topic is always fine — no new subscribe is needed.
    if (this._connected || this._connecting != null) {
      const topic = this._topicName(eventName);
      if (!this._subscribedTopics.has(topic)) {
        throw new Error(
          `KafkaEventBus: on("${eventName}") called after connect() was started. ` +
            `Kafka does not allow subscribing to a new topic ("${topic}") on a ` +
            `running consumer, so this handler's events would be silently lost. ` +
            `Register all handlers with on() before calling connect().`,
        );
      }
    }

    const existing = this._handlers.get(eventName) ?? [];
    this._handlers.set(eventName, [...existing, handler]);
  }

  /**
   * Publishes an event to the Kafka topic derived from the event name.
   * The full event object is serialized as JSON.
   * The message key is derived from the `partitionKeyStrategy` config option
   * (default: `"aggregateId"` — uses `event.metadata?.aggregateId`).
   * Topics for events with a registered handler are provisioned during
   * `connect()` (see `_provisionTopics`). A publish-only topic that was
   * never registered via `on()` is NOT auto-provisioned here (out of scope
   * for this pass — see spec note); such a bus still relies on broker
   * auto-create defaults for that specific topic.
   *
   * @throws If called before `connect()` or after `close()`.
   */
  async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    if (this._closed || !this._connected || this._producer == null) {
      throw new Error("KafkaEventBus is not connected. Call connect() first.");
    }

    const topic = this._topicName(event.name);
    const value = JSON.stringify(event);
    const key = this._resolvePartitionKey(event);

    await this._producer.send({
      topic,
      messages: [
        {
          key,
          value,
          headers: { "content-type": WIRE_CONTENT_TYPE },
        },
      ],
    });
  }

  /**
   * Performs a throwaway publish/consume round-trip on a dedicated internal
   * topic to force the Kafka cluster past cold-start latency (topic
   * creation, leader election, ISR sync) before real traffic flows.
   *
   * Must be called after `connect()`. Idempotent: after the first
   * successful call, subsequent calls resolve immediately without
   * repeating the round-trip. Concurrent overlapping calls are deduplicated
   * via an in-flight promise mutex, mirroring `connect()`'s dedup pattern.
   *
   * @throws If called before `connect()` or after `close()`.
   * @throws If the round-trip does not complete within `warmupTimeoutMs`
   *   (default 60000ms).
   */
  async warmup(): Promise<void> {
    if (this._closed || !this._connected) {
      throw new Error("KafkaEventBus is not connected. Call connect() first.");
    }

    if (this._warmedUp) {
      return;
    }

    // Deduplicate concurrent warmup() calls: if a round-trip is already in
    // progress, await that promise rather than starting a parallel one.
    if (this._warmingUp != null) {
      return this._warmingUp;
    }

    const warmingUp = (async () => {
      try {
        const warmupTopic = this._topicName(this._warmupEventName);
        if (!this._subscribedTopics.has(warmupTopic)) {
          // Not provisioned during connect() (warmupOnConnect wasn't set).
          // kafkajs forbids subscribing to a new topic while the consumer
          // is running, so we stop it, add the subscription, and restart
          // the fetch loop — the "expensive but correct" late-subscribe
          // path, scoped only to the warmup topic.
          await this._consumer!.stop();
          await this._provisionWarmupTopic();
          await this._consumer!.subscribe({
            topic: warmupTopic,
            fromBeginning: false,
          });
          this._subscribedTopics.add(warmupTopic);
          await this._runConsumerLoop();
        }

        await this._performWarmupRoundTrip();
        this._warmedUp = true;
      } finally {
        this._warmingUp = null;
      }
    })();

    this._warmingUp = warmingUp;
    return warmingUp;
  }

  /**
   * Repeatedly dispatches a throwaway event to the warmup topic (on a
   * 1-second interval) until the persistent internal warmup handler
   * (registered once in `connect()`, before `consumer.run()`) observes it,
   * or until `warmupTimeoutMs` elapses. The subscription itself is already
   * in place by the time this runs — see `connect()` — since kafkajs
   * forbids subscribing to a new topic after the consumer starts running.
   */
  private _performWarmupRoundTrip(): Promise<void> {
    const timeoutMs = this._config.warmupTimeoutMs ?? 60000;
    const eventName = this._warmupEventName;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      // intervalId/timeoutId are assigned *before* the first dispatchOnce()
      // call below (not after) — the internal warmup handler, and
      // potentially a very fast real broker, can invoke finish()
      // synchronously from within that first call (dispatch() -> a mock or
      // zero-latency producer -> the consumer's eachMessage -> the warmup
      // handler, all in the same synchronous call stack). If the handles
      // were assigned after dispatchOnce(), finish() would call
      // clearInterval/clearTimeout on still-undefined values (no-ops), and
      // the interval would keep firing warmup dispatches forever even
      // after warmup already succeeded.
      let intervalId: ReturnType<typeof setInterval>;
      let timeoutId: ReturnType<typeof setTimeout>;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        this._warmupWaiters.delete(finish);
        clearInterval(intervalId);
        clearTimeout(timeoutId);
        resolve();
      };

      this._warmupWaiters.add(finish);

      const dispatchOnce = (): void => {
        this.dispatch({ name: eventName, payload: { warmup: true } }).catch(
          (err: unknown) => {
            this._logger.warn(
              `Warmup dispatch to topic "${eventName}" failed; will retry.`,
              { eventName, error: String(err) },
            );
          },
        );
      };

      intervalId = setInterval(dispatchOnce, 1000);
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._warmupWaiters.delete(finish);
        clearInterval(intervalId);
        reject(
          new Error(
            `KafkaEventBus warmup timed out after ${timeoutMs}ms waiting for round-trip on topic "${eventName}"`,
          ),
        );
      }, timeoutMs);
      dispatchOnce();
    });
  }

  /**
   * Disconnects the producer and consumer, and clears the handler registry.
   * After `close()`, `dispatch()` and `on()` throw.
   * Idempotent: subsequent calls resolve immediately.
   */
  async close(): Promise<void> {
    if (this._closed) {
      return;
    }

    this._closed = true;
    this._connected = false;

    if (this._consumer != null) {
      // stop() lets in-flight handlers complete before we disconnect.
      await this._consumer.stop();
      await this._consumer.disconnect();
      this._consumer = null;
    }

    if (this._producer != null) {
      await this._producer.disconnect();
      this._producer = null;
    }

    this._handlers.clear();
    this._subscribedTopics.clear();
  }

  /**
   * Internal method that deserializes an incoming Kafka message and invokes
   * all registered handlers for the given event name concurrently via
   * `Promise.allSettled`. Exposed as a private method (accessible via
   * `(bus as any)._handleMessage`) so tests can simulate message delivery
   * without a real Kafka cluster.
   *
   * Poison message protection: if `JSON.parse` throws, the error is logged
   * and (when `location` is known) the raw message is best-effort parked to
   * the DLQ topic, then the method returns without throwing (allowing the
   * consumer to commit the offset and skip the malformed message). Poison
   * messages are never retried — a re-fetch of the same bytes can never
   * parse successfully.
   *
   * Handler failures: below the retry cap (`resilience.maxRetries`, default
   * `DEFAULT_MAX_RETRIES`), the first rejection is re-thrown as before —
   * the outer consumer loop skips the offset commit and Kafka redelivers.
   * Once the cap is exceeded, the message is parked to the DLQ topic and
   * this method returns normally instead of throwing, so the offset commits
   * and the shared consumer proceeds to the next message rather than
   * perpetually crash/rebalance-looping on the same one.
   *
   * @param eventName - The event name derived from the Kafka topic.
   * @param rawValue - The raw JSON string from the Kafka message value.
   * @param location - The message's topic/partition/offset. Used for
   *   delivery-count tracking and DLQ parking. When omitted (e.g. direct
   *   unit-test calls with only 2 arguments), the legacy contract applies
   *   unconditionally: on failure, the first rejection is always re-thrown
   *   immediately, with no cap and no DLQ involvement.
   */
  private async _handleMessage(
    eventName: string,
    rawValue: string,
    location?: { topic: string; partition: number; offset: string },
  ): Promise<void> {
    const offsetKey = location
      ? `${location.topic}:${location.partition}:${location.offset}`
      : undefined;

    // Poison message protection — catch JSON parse errors and skip. Never
    // retried (re-parsing the same bytes can never succeed), so this is
    // parked directly rather than going through the retry-count/cap path.
    let event: Event;
    try {
      event = JSON.parse(rawValue) as Event;
    } catch (err) {
      this._logger.warn(
        `Failed to deserialize message for event "${eventName}". Skipping poison message.`,
        { eventName, error: String(err) },
      );
      if (location !== undefined) {
        await this._parkToDlq(location, eventName, rawValue, err, 1).catch(
          (dlqErr: unknown) => {
            this._logger.error(
              `Failed to park poison message to DLQ; message is skipped without a DLQ copy.`,
              { eventName, error: String(dlqErr) },
            );
          },
        );
      }
      return;
    }

    const handlers = this._handlers.get(eventName) ?? [];

    const results = await Promise.allSettled(
      handlers.map((handler) => handler(event)),
    );

    const { traceId, spanId } =
      this._instrumentation.getActiveTraceCorrelation();

    let firstRejection: unknown = undefined;
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "rejected") {
        const handler = handlers[i]!;
        const err = result.reason;
        const handlerName =
          handler.name && handler.name !== "handler" && handler.name !== ""
            ? handler.name
            : event.name;

        const errorFields =
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : { name: "Error", message: String(err) };

        this._logger.error(
          `Handler "${handlerName}" failed for event "${event.name}"`,
          {
            eventName: event.name,
            ...(event.metadata?.eventId !== undefined && {
              eventId: event.metadata.eventId,
            }),
            handlerName,
            error: errorFields,
            ...(traceId !== undefined && { traceId }),
            ...(spanId !== undefined && { spanId }),
          },
        );

        if (firstRejection === undefined) {
          firstRejection = err;
        }
      }
    }

    if (firstRejection === undefined) {
      return;
    }

    // Legacy contract: no location means no cap, no DLQ — always re-throw.
    if (location === undefined || offsetKey === undefined) {
      throw firstRejection;
    }

    const maxRetries =
      this._config.resilience?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const attempt = (this._deliveryCounts.get(offsetKey) ?? 0) + 1;
    this._deliveryCounts.set(offsetKey, attempt);

    if (attempt <= maxRetries) {
      throw this._markRetriable(firstRejection);
    }

    try {
      await this._parkToDlq(
        location,
        eventName,
        rawValue,
        firstRejection,
        attempt,
      );
    } catch (dlqErr) {
      this._logger.error(
        `Failed to park exhausted-retry message to DLQ topic; leaving offset uncommitted for redelivery.`,
        { eventName, error: String(dlqErr) },
      );
      throw this._markRetriable(firstRejection);
    }
    this._deliveryCounts.delete(offsetKey);
  }

  /**
   * kafkajs's `consumer.run()` only invokes `retry.restartOnFailure` (and
   * thus restarts the crashed fetch loop) when the crash error itself is
   * marked `retriable` — a plain `Error` short-circuits that check and the
   * consumer stays down permanently, never redelivering the uncommitted
   * offset. Handler rejections are ordinary application errors, so this
   * flags them retriable before they're rethrown to crash the consumer.
   */
  private _markRetriable(err: unknown): unknown {
    if (err instanceof Error) {
      (err as Error & { retriable?: boolean }).retriable = true;
    }
    return err;
  }

  /**
   * Publishes the original, unmodified message value to the message's DLQ
   * topic (`${location.topic}${dlqTopicSuffix}`), with Kafka headers
   * carrying failure metadata so operators can inspect and replay the
   * payload. Also provisions the DLQ topic on first use. Emits a
   * `logger.error` at the moment of parking.
   */
  private async _parkToDlq(
    location: { topic: string; partition: number; offset: string },
    eventName: string,
    rawValue: string,
    error: unknown,
    attempts: number,
  ): Promise<void> {
    const dlqTopic = `${location.topic}${this._config.dlqTopicSuffix ?? ".dlq"}`;
    await this._provisionTopics([dlqTopic]);

    const errorMessage = error instanceof Error ? error.message : String(error);
    const timestamp = new Date().toISOString();

    await this._producer!.send({
      topic: dlqTopic,
      messages: [
        {
          value: rawValue,
          headers: {
            "content-type": WIRE_CONTENT_TYPE,
            "x-noddde-dlq-error": errorMessage,
            "x-noddde-dlq-attempts": String(attempts),
            "x-noddde-dlq-original-topic": location.topic,
            "x-noddde-dlq-original-partition": String(location.partition),
            "x-noddde-dlq-original-offset": location.offset,
            "x-noddde-dlq-timestamp": timestamp,
          },
        },
      ],
    });

    this._logger.error(
      `Message for event "${eventName}" exhausted retries; parked to DLQ topic "${dlqTopic}".`,
      {
        eventName,
        dlqTopic,
        attempts,
        error: errorMessage,
        originalTopic: location.topic,
        originalPartition: location.partition,
        originalOffset: location.offset,
      },
    );
  }

  /**
   * Resolves the Kafka message key for a given event using the configured
   * `partitionKeyStrategy`. Returns `null` for round-robin partition assignment.
   */
  private _resolvePartitionKey(event: Event): string | null {
    const strategy = this._config.partitionKeyStrategy ?? "aggregateId";
    if (typeof strategy === "function") return strategy(event);
    const id = event.metadata?.aggregateId;
    return id != null ? String(id) : null;
  }

  /** Derives the Kafka topic name for a given event name. */
  private _topicName(eventName: string): string {
    const prefix = this._config.topicPrefix ?? "";
    return `${prefix}${eventName}`;
  }
}
