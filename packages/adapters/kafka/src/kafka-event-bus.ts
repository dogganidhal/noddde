import { Kafka, type Producer, type Consumer } from "kafkajs";
import type {
  AsyncEventHandler,
  BrokerResilience,
  Connectable,
  EventBus,
  Logger,
} from "@noddde/core";
import type { Event } from "@noddde/core";
import { Instrumentation, NodddeLogger } from "@noddde/engine";

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
  // eslint-disable-next-line no-unused-vars
  partitionKeyStrategy?: "aggregateId" | ((event: Event) => string | null);
  /** Framework logger instance. Defaults to NodddeLogger("warn", "noddde:kafka") from @noddde/engine. */
  logger?: Logger;
  /**
   * OpenTelemetry instrumentation used to enrich per-handler error logs with
   * `traceId`/`spanId` correlation fields. Defaults to a no-op instance.
   */
  instrumentation?: Instrumentation;
}

/**
 * Kafka-backed EventBus implementation using `kafkajs`.
 *
 * Publishes domain events to Kafka topics and delivers them to registered
 * handlers via consumer groups. Provides at-least-once delivery with
 * partition-level ordering.
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
  private _kafka: Pick<Kafka, "producer" | "consumer">;
  private _producer: Producer | null = null;
  private _consumer: Consumer | null = null;
  private _connected = false;
  private _closed = false;
  /**
   * In-flight connection promise used to deduplicate concurrent `connect()` calls.
   * Set at the start of connection, cleared in a finally block when done.
   */
  private _connecting: Promise<void> | null = null;
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

  constructor(config: KafkaEventBusConfig) {
    this._config = config;
    this._logger = config.logger ?? new NodddeLogger("warn", "noddde:kafka");
    this._instrumentation = config.instrumentation ?? new Instrumentation(null);
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
        });

        await this._producer.connect();
        await this._consumer.connect();

        // Subscribe to topics for all handlers registered before connect
        for (const eventName of this._handlers.keys()) {
          const topic = this._topicName(eventName);
          if (!this._subscribedTopics.has(topic)) {
            await this._consumer!.subscribe({ topic, fromBeginning: false });
            this._subscribedTopics.add(topic);
          }
        }

        // Wait for the consumer to be polling for messages before
        // `connect()` resolves. Without this, `consumer.run()` returns
        // immediately and the caller can dispatch a message *before* the
        // consumer's initial offset fetch completes — with the default
        // `fromBeginning: false`, that first message gets skipped because
        // the offset reset happens after it was published.
        //
        // We listen for the kafkajs `FETCH_START` event rather than
        // `GROUP_JOIN`: GROUP_JOIN fires after partition assignment, but
        // before the consumer's initial offset fetch lands, so a
        // message published right after GROUP_JOIN can still end up
        // below the consumer's eventual starting position.
        // `FETCH_START` only fires once the consumer is actually polling,
        // which is the moment we can guarantee subsequent publishes will
        // be delivered.
        let fetchStarted!: () => void;
        const fetchStartedPromise = new Promise<void>((resolve) => {
          fetchStarted = resolve;
        });
        const unsubscribe = this._consumer.on(
          this._consumer.events.FETCH_START,
          () => fetchStarted(),
        );

        await this._consumer.run({
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
            await this._handleMessage(eventName, rawValue, offsetKey);

            // Explicitly commit the offset after all handlers succeeded.
            // Without this, kafkajs never persists offsets when autoCommit is false.
            await this._consumer!.commitOffsets([
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
        // fetching. With no subscribed topics there's nothing to wait
        // for — kafkajs won't emit FETCH_START at all. Cap at 30s so a
        // misconfigured broker doesn't hang the process forever.
        if (this._subscribedTopics.size > 0) {
          await Promise.race([
            fetchStartedPromise,
            new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
          ]);
        }
        unsubscribe();

        this._connected = true;
      } finally {
        this._connecting = null;
      }
    })();

    this._connecting = connecting;
    return connecting;
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
   * `on()` after `connect()` for an event whose topic is **not** yet
   * subscribed throws: kafkajs forbids subscribing to a new topic on a
   * running consumer (`Cannot subscribe to topic while consumer is running`),
   * so the subscription cannot take effect and the messages would be silently
   * lost. Register all handlers before `connect()`.
   *
   * @throws If called after `close()`.
   * @throws If called after `connect()` for an event whose topic is not
   *   already subscribed.
   */
  on(eventName: string, handler: AsyncEventHandler): void {
    if (this._closed) {
      throw new Error("KafkaEventBus is closed");
    }

    // After connect(), a new topic subscription can't be added to a running
    // kafkajs consumer. Fail loudly instead of silently dropping the handler's
    // messages. Registering another handler for an already-subscribed topic is
    // fine — no new subscribe is needed.
    if (this._connected) {
      const topic = this._topicName(eventName);
      if (!this._subscribedTopics.has(topic)) {
        throw new Error(
          `KafkaEventBus: on("${eventName}") called after connect(). Kafka does not ` +
            `allow subscribing to a new topic ("${topic}") on a running consumer, so ` +
            `this handler's events would be silently lost. Register all handlers with ` +
            `on() before calling connect().`,
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
        },
      ],
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
   * all registered handlers for the given event name concurrently via `Promise.all`.
   * Exposed as a private method (accessible via `(bus as any)._handleMessage`)
   * so tests can simulate message delivery without a real Kafka cluster.
   *
   * Poison message protection: if `JSON.parse` throws, the error is logged and
   * the method returns without throwing (allowing the consumer to commit the
   * offset and skip the malformed message). Poison messages will not block
   * the partition via infinite redelivery.
   *
   * maxRetries enforcement: if `resilience.maxRetries` is configured, the delivery
   * count for the given offset key is incremented on each call. If the count exceeds
   * `maxRetries`, a warning is logged and the method returns (skipping the message).
   *
   * If any handler rejects, the error propagates and the consumer will not commit
   * the offset, enabling redelivery. Handlers that already completed will re-execute
   * on redelivery — consumers must be idempotent.
   *
   * @param eventName - The event name derived from the Kafka topic.
   * @param rawValue - The raw JSON string from the Kafka message value.
   * @param offsetKey - Optional unique key for the message (topic:partition:offset).
   *   Used for maxRetries tracking. When omitted (e.g., in direct test calls),
   *   maxRetries enforcement is skipped.
   */
  private async _handleMessage(
    eventName: string,
    rawValue: string,
    offsetKey?: string,
  ): Promise<void> {
    // Fix 4: maxRetries enforcement via in-memory delivery count.
    const maxRetries = this._config.resilience?.maxRetries;
    if (maxRetries !== undefined && offsetKey !== undefined) {
      const current = (this._deliveryCounts.get(offsetKey) ?? 0) + 1;
      this._deliveryCounts.set(offsetKey, current);
      if (current > maxRetries) {
        this._logger.warn(
          `Message at ${offsetKey} exceeded maxRetries (${maxRetries}). Skipping.`,
          { offsetKey, maxRetries, deliveryCount: current },
        );
        return;
      }
    }

    // Fix 3: Poison message protection — catch JSON parse errors and skip.
    let event: Event;
    try {
      event = JSON.parse(rawValue) as Event;
    } catch (err) {
      this._logger.warn(
        `Failed to deserialize message for event "${eventName}". Skipping poison message.`,
        { eventName, error: String(err) },
      );
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

    if (firstRejection !== undefined) {
      throw firstRejection;
    }
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
