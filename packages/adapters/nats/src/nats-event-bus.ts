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
} from "@noddde/core";
import type { Event } from "@noddde/core";

/** Configuration for the NatsEventBus. */
export interface NatsEventBusConfig {
  /** NATS server URL(s) (e.g., "localhost:4222" or ["nats://host1:4222", "nats://host2:4222"]). */
  servers: string | string[];
  /** JetStream stream name for durable subscriptions (e.g., "noddde-events"). */
  streamName?: string;
  /** Optional prefix prepended to event names to form subject names (e.g., "noddde." → "noddde.AccountCreated"). */
  subjectPrefix?: string;
  /** Maximum number of unacknowledged messages per consumer (default: 256). Provides backpressure control. */
  prefetchCount?: number;
  /** Connection resilience configuration (default: maxAttempts=-1/infinite, initialDelayMs=2000). NATS uses fixed intervals — maxDelayMs is ignored. */
  resilience?: BrokerResilience;
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
 * const bus = new NatsEventBus({ servers: "localhost:4222", streamName: "noddde-events" });
 * await bus.connect();
 * bus.on("AccountCreated", async (event) => { ... });
 * await bus.dispatch({ name: "AccountCreated", payload: { id: "acc-1" } });
 * await bus.close();
 * ```
 */
export class NatsEventBus implements EventBus, Connectable {
  private readonly _config: NatsEventBusConfig;
  private _nc: NatsConnection | null = null;
  private _js: JetStreamClient | null = null;
  private _connected: boolean = false;
  private readonly _handlers: Map<string, AsyncEventHandler[]> = new Map();
  private _closed: boolean = false;

  constructor(config: NatsEventBusConfig) {
    this._config = config;
  }

  /**
   * Establishes a connection to the NATS server and initializes JetStream.
   * Must be called before `dispatch` or `on` (after calling `on` is also supported — handlers
   * registered before `connect()` are buffered and subscriptions are created when `connect()` is called).
   * Idempotent: subsequent calls when already connected are no-ops.
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

    // Activate any buffered subscriptions
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

    // If already connected, create a subscription immediately
    if (this._connected && this._js) {
      void this._createSubscriptionForEvent(eventName);
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

  private async _activateSubscriptions(): Promise<void> {
    for (const eventName of this._handlers.keys()) {
      await this._createSubscriptionForEvent(eventName);
    }
  }

  private async _createSubscriptionForEvent(eventName: string): Promise<void> {
    if (!this._js) {
      return;
    }

    const subject = this._subjectFor(eventName);
    const durableName = eventName.replace(/[^a-zA-Z0-9_-]/g, "_");

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
        console.error(
          `[NatsEventBus] Consumer loop for "${eventName}" terminated:`,
          err,
        );
      });
    } catch (err) {
      // Subscription creation failed — caller should handle reconnect logic
      console.error(
        `[NatsEventBus] Failed to create subscription for "${eventName}":`,
        err,
      );
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
        console.error(
          `[NatsEventBus] Poison message for "${eventName}". Discarding.`,
          err,
        );
        try {
          msg.term();
        } catch {
          // connection dropped between receipt and term
        }
        continue;
      }
      try {
        await this._handleMessage(eventName, JSON.stringify(event));
        try {
          msg.ack();
        } catch {
          // connection dropped between handler completion and ack
        }
      } catch (err) {
        // Handler failure — request immediate redelivery via nak()
        console.error(`[NatsEventBus] Handler error for "${eventName}".`, err);
        try {
          msg.nak();
        } catch {
          // connection dropped between handler failure and nak
        }
      }
    }
  }
}
