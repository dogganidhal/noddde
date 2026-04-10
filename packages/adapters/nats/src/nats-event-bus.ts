import {
  connect,
  consumerOpts,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
} from "nats";
import type {
  AsyncEventHandler,
  BrokerResilience,
  Connectable,
  EventBus,
  Logger,
} from "@noddde/core";
import type { Event } from "@noddde/core";
import { NodddeLogger } from "@noddde/engine";

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

/**
 * NATS-backed EventBus implementation using the `nats` client library with JetStream for durable
 * subscriptions. Publishes domain events to NATS subjects and delivers them to registered handlers
 * via JetStream consumers. Provides at-least-once delivery with durable subscriptions.
 *
 * Suitable for distributed deployments where lightweight, high-throughput event streaming is required.
 *
 * @example
 * ```ts
 * const bus = new NatsEventBus({
 *   servers: "localhost:4222",
 *   consumerGroup: "my-service",
 *   streamName: "noddde-events",
 * });
 * await bus.connect();
 * bus.on("AccountCreated", async (event) => { ... });
 * await bus.dispatch({ name: "AccountCreated", payload: { id: "acc-1" } });
 * await bus.close();
 * ```
 */
export class NatsEventBus implements EventBus, Connectable {
  private readonly _config: NatsEventBusConfig;
  private readonly _logger: Logger;
  private _nc: NatsConnection | null = null;
  private _js: JetStreamClient | null = null;
  private _connected: boolean = false;
  private readonly _handlers: Map<string, AsyncEventHandler[]> = new Map();
  private _closed: boolean = false;

  constructor(config: NatsEventBusConfig) {
    this._config = config;
    this._logger = config.logger ?? new NodddeLogger("warn", "noddde:nats");
  }

  /**
   * Establishes a connection to the NATS server and initializes JetStream.
   * Must be called before `dispatch` or `on` (after calling `on` is also supported — handlers
   * registered before `connect()` are buffered and subscriptions are created when `connect()` is called).
   * Idempotent: subsequent calls when already connected are no-ops.
   *
   * @throws If any subscription activation fails during `_activateSubscriptions`.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      return;
    }

    const resilience = this._config.resilience;
    const nc = await connect({
      servers: this._config.servers,
      reconnect: true,
      maxReconnectAttempts: resilience?.maxAttempts ?? -1,
      reconnectTimeWait: resilience?.initialDelayMs ?? 2000,
    });
    this._nc = nc;
    this._js = nc.jetstream();
    this._connected = true;

    // If a streamName is configured, create or verify the stream
    if (this._config.streamName) {
      const jsm: JetStreamManager = await nc.jetstreamManager();
      try {
        await jsm.streams.info(this._config.streamName);
      } catch {
        // Stream does not exist, create it
        const subjects = this._buildSubjectsForStream();
        await jsm.streams.add({
          name: this._config.streamName,
          subjects,
        });
      }
    }

    // Activate any buffered subscriptions — fail fast on any error
    await this._activateSubscriptions();
  }

  /**
   * Registers a handler for a given event name.
   * If called before `connect()`, the handler is buffered; subscriptions are created when
   * `connect()` is called. Multiple handlers per event name are supported (fan-out).
   *
   * @throws If called after `close()`.
   */
  on(eventName: string, handler: AsyncEventHandler): void {
    if (this._closed) {
      throw new Error("Cannot register handlers on a closed NatsEventBus.");
    }

    const existing = this._handlers.get(eventName) ?? [];
    existing.push(handler);
    this._handlers.set(eventName, existing);

    // If already connected, create a subscription immediately (late registration — log errors, don't crash)
    if (this._connected && this._js) {
      void this._createSubscriptionForEvent(eventName, false);
    }
  }

  /**
   * Publishes an event to the NATS subject derived from the event name.
   * The subject is `${subjectPrefix}${event.name}` (default prefix is empty string).
   * Awaits the JetStream publish acknowledgment.
   *
   * @throws If called before `connect()` or after `close()`.
   */
  async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    if (!this._connected || !this._js) {
      throw new Error(
        "NatsEventBus is not connected. Call connect() before dispatch().",
      );
    }

    const subject = this._subjectFor(event.name);
    const data = new TextEncoder().encode(JSON.stringify(event));
    await this._js.publish(subject, data);
  }

  /**
   * Drains the NATS connection (processes in-flight messages, then disconnects),
   * and clears the handler registry. Idempotent.
   */
  async close(): Promise<void> {
    if (this._closed) {
      return;
    }

    this._closed = true;
    this._connected = false;

    if (this._nc) {
      const nc = this._nc;
      this._nc = null;
      this._js = null;
      if (!nc.isClosed()) {
        await nc.drain();
      }
    }

    this._handlers.clear();
  }

  /**
   * Handles an incoming NATS message for the given event name.
   * Deserializes the message, invokes all registered handlers concurrently via `Promise.all()`,
   * and returns. If any handler rejects, the rejection propagates and the message is not acknowledged.
   * Exposed as a semi-private method for testability.
   *
   * @param eventName - The event name (used to look up handlers).
   * @param messageData - Raw JSON string from the NATS message.
   */
  async _handleMessage(eventName: string, messageData: string): Promise<void> {
    const event = JSON.parse(messageData) as Event;
    const handlers = this._handlers.get(eventName) ?? [];
    await Promise.all(handlers.map((handler) => handler(event)));
  }

  private _subjectFor(eventName: string): string {
    const prefix = this._config.subjectPrefix ?? "";
    return `${prefix}${eventName}`;
  }

  private _buildSubjectsForStream(): string[] {
    const prefix = this._config.subjectPrefix ?? "";
    // Use a wildcard subject for the stream to capture all events
    return [`${prefix}>`];
  }

  /**
   * Activates subscriptions for all buffered handlers.
   * Throws immediately if any subscription creation fails (fail-fast during connect).
   */
  private async _activateSubscriptions(): Promise<void> {
    for (const eventName of this._handlers.keys()) {
      await this._createSubscriptionForEvent(eventName, true);
    }
  }

  /**
   * Creates a JetStream consumer subscription for the given event name.
   *
   * @param eventName - The event name to subscribe to.
   * @param failFast - If true, re-throws subscription errors (used during connect). If false,
   *   logs errors without throwing (used for late `on()` registrations after connect).
   */
  private async _createSubscriptionForEvent(
    eventName: string,
    failFast: boolean = false,
  ): Promise<void> {
    if (!this._js) {
      return;
    }

    const subject = this._subjectFor(eventName);
    const sanitized = eventName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const durableName = `${this._config.consumerGroup}_${sanitized}`;

    const opts = consumerOpts();
    opts.durable(durableName);
    opts.manualAck();
    opts.filterSubject(subject);
    opts.maxAckPending(this._config.prefetchCount ?? 256);

    const maxRetries = this._config.resilience?.maxRetries;
    if (maxRetries !== undefined) {
      opts.maxDeliver(maxRetries);
    }

    try {
      const sub = await this._js.subscribe(subject, opts);
      this._consumeSubscription(sub, eventName).catch((err) => {
        this._logger.error("Consumer loop terminated unexpectedly", {
          eventName,
          error: String(err),
        });
      });
    } catch (err) {
      if (failFast) {
        throw err;
      }
      // Late registration failure — log but don't crash
      this._logger.error("Failed to create subscription for event", {
        eventName,
        error: String(err),
      });
    }
  }

  private async _consumeSubscription(
    sub: AsyncIterable<import("nats").JsMsg>,
    eventName: string,
  ): Promise<void> {
    for await (const msg of sub) {
      let event: import("@noddde/core").Event;
      try {
        event = JSON.parse(
          new TextDecoder().decode(msg.data),
        ) as import("@noddde/core").Event;
      } catch (err) {
        this._logger.error("Poison message received — discarding", {
          eventName,
          error: String(err),
        });
        try {
          msg.term();
        } catch (termErr) {
          this._logger.warn(
            "Failed to term poison message (connection dropped?)",
            { eventName, error: String(termErr) },
          );
        }
        continue;
      }
      try {
        await this._handleMessage(eventName, JSON.stringify(event));
        try {
          msg.ack();
        } catch (ackErr) {
          this._logger.warn("Failed to ack message (connection dropped?)", {
            eventName,
            error: String(ackErr),
          });
        }
      } catch (err) {
        // Handler failure — request immediate redelivery via nak()
        this._logger.error("Handler error for event", {
          eventName,
          error: String(err),
        });
        try {
          msg.nak();
        } catch (nakErr) {
          this._logger.warn("Failed to nak message (connection dropped?)", {
            eventName,
            error: String(nakErr),
          });
        }
      }
    }
  }
}
