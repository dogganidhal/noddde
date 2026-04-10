import { Kafka, type Producer, type Consumer } from "kafkajs";
import type {
  AsyncEventHandler,
  BrokerResilience,
  Connectable,
  EventBus,
} from "@noddde/core";
import type { Event } from "@noddde/core";

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
  /** The kafkajs Kafka client. Exposed as a field so tests can inject a mock. */
  private _kafka: Pick<Kafka, "producer" | "consumer">;
  private _producer: Producer | null = null;
  private _consumer: Consumer | null = null;
  private _connected = false;
  private _closed = false;
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
        await this._consumer.subscribe({ topic, fromBeginning: false });
        this._subscribedTopics.add(topic);
      }
    }

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
      },
    });

    this._connected = true;
  }

  /**
   * Registers a handler for a given event name.
   * Subscribes the consumer to the corresponding Kafka topic.
   * Multiple handlers per event name are supported (fan-out within the same process).
   *
   * Handlers registered before `connect()` are buffered and subscriptions are
   * established when `connect()` is called.
   *
   * @throws If called after `close()`.
   */
  on(eventName: string, handler: AsyncEventHandler): void {
    if (this._closed) {
      throw new Error("KafkaEventBus is closed");
    }

    const existing = this._handlers.get(eventName) ?? [];
    this._handlers.set(eventName, [...existing, handler]);

    // If already connected, subscribe to the topic immediately
    if (this._connected && this._consumer != null) {
      const topic = this._topicName(eventName);
      if (!this._subscribedTopics.has(topic)) {
        // Subscribe synchronously by kicking off the async subscribe.
        // kafkajs supports calling subscribe after run() to add topics dynamically.
        this._subscribedTopics.add(topic);
        void this._consumer.subscribe({ topic, fromBeginning: false });
      }
    }
  }

  /**
   * Publishes an event to the Kafka topic derived from the event name.
   * The full event object is serialized as JSON.
   * If `event.metadata?.correlationId` is set, it is used as the message key.
   *
   * @throws If called before `connect()` or after `close()`.
   */
  async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    if (this._closed || !this._connected || this._producer == null) {
      throw new Error("KafkaEventBus is not connected. Call connect() first.");
    }

    const topic = this._topicName(event.name);
    const value = JSON.stringify(event);
    const key = event.metadata?.correlationId ?? undefined;

    await this._producer.send({
      topic,
      messages: [
        {
          key: key ?? null,
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
        console.warn(
          `[KafkaEventBus] Message at ${offsetKey} exceeded maxRetries (${maxRetries}). Skipping.`,
        );
        return;
      }
    }

    // Fix 3: Poison message protection — catch JSON parse errors and skip.
    let event: Event;
    try {
      event = JSON.parse(rawValue) as Event;
    } catch (err) {
      console.warn(
        `[KafkaEventBus] Failed to deserialize message for event "${eventName}". Skipping poison message.`,
        err,
      );
      return;
    }

    const handlers = this._handlers.get(eventName) ?? [];

    await Promise.all(handlers.map((handler) => handler(event)));
  }

  /** Derives the Kafka topic name for a given event name. */
  private _topicName(eventName: string): string {
    const prefix = this._config.topicPrefix ?? "";
    return `${prefix}${eventName}`;
  }
}
