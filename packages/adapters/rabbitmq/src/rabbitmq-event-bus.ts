import type {
  AsyncEventHandler,
  BrokerResilience,
  Connectable,
  EventBus,
} from "@noddde/core";
import type { Event } from "@noddde/core";
import type { ChannelModel, ConfirmChannel } from "amqplib";
import amqplib from "amqplib";

/**
 * Configuration for the RabbitMqEventBus.
 */
export interface RabbitMqEventBusConfig {
  /** RabbitMQ connection URL (e.g., "amqp://localhost:5672"). */
  url: string;
  /** Exchange name for event publishing (default: "noddde.events"). */
  exchangeName?: string;
  /**
   * Exchange type: "topic" (default) or "fanout".
   * Topic uses event name as routing key.
   */
  exchangeType?: "topic" | "fanout";
  /**
   * Queue name prefix for consumer queues (default: "noddde").
   * Queues are named "${queuePrefix}.${eventName}".
   */
  queuePrefix?: string;
  /**
   * Number of unacknowledged messages the broker may send to this consumer (default: 10).
   * Provides backpressure control via channel.prefetch().
   */
  prefetchCount?: number;
  /**
   * Connection resilience configuration (default: maxAttempts=3, initialDelayMs=1000, maxDelayMs=30000).
   * amqplib has no built-in reconnection — retry is implemented manually with exponential backoff.
   */
  resilience?: BrokerResilience;
}

/**
 * RabbitMQ-backed EventBus implementation using `amqplib`.
 *
 * Publishes domain events to a RabbitMQ exchange and delivers them to
 * registered handlers via bound queues. Provides at-least-once delivery
 * with manual acknowledgment.
 *
 * Suitable for distributed deployments where reliable message brokering
 * with flexible routing is required.
 *
 * @example
 * ```ts
 * const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
 * await bus.connect();
 * bus.on("AccountCreated", async (event) => { ... });
 * ```
 */
export class RabbitMqEventBus implements EventBus, Connectable {
  private readonly _exchangeName: string;
  private readonly _exchangeType: "topic" | "fanout";
  private readonly _queuePrefix: string;
  private readonly _url: string;
  private readonly _prefetchCount: number;

  /**
   * Full config stored for test inspection.
   * @internal
   */
  _config: RabbitMqEventBusConfig;

  /** Registry of handlers per event name. */
  private readonly _handlers: Map<string, AsyncEventHandler[]> = new Map();

  /**
   * Internal AMQP connection model (exposed for test injection).
   * @internal
   */
  _connection: ChannelModel | null = null;

  /**
   * Internal AMQP confirm channel (exposed for test injection).
   * Using ConfirmChannel enables publisher confirms via waitForConfirms().
   * @internal
   */
  _channel: ConfirmChannel | null = null;

  /**
   * Whether the bus is currently connected (exposed for test injection).
   * @internal
   */
  _connected: boolean = false;

  /** Whether close() has been called explicitly. */
  private _closed: boolean = false;

  /** Whether a reconnection attempt is currently in progress. */
  private _reconnecting: boolean = false;

  constructor(config: RabbitMqEventBusConfig) {
    this._config = config;
    this._url = config.url;
    this._exchangeName = config.exchangeName ?? "noddde.events";
    this._exchangeType = config.exchangeType ?? "topic";
    this._queuePrefix = config.queuePrefix ?? "noddde";
    this._prefetchCount = config.prefetchCount ?? 10;
  }

  /**
   * Establishes a connection and confirm channel to RabbitMQ. Asserts the exchange.
   * Must be called before `dispatch` or `on`.
   * Idempotent: calling when already connected is a no-op.
   *
   * Uses a confirm channel so that `dispatch()` can await `waitForConfirms()`
   * to guarantee the broker has accepted the message.
   *
   * Retries with exponential backoff if `resilience` is configured.
   * Default: 3 attempts, 1000ms initial delay, 30000ms max delay.
   *
   * After connecting, registers `error` and `close` handlers on the connection
   * to trigger automatic reconnection on unexpected disconnection.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      return;
    }

    await this._connectWithRetry();
  }

  /**
   * Internal connection logic with exponential backoff retry.
   * Shared between initial connect() and mid-session reconnection.
   */
  private async _connectWithRetry(): Promise<void> {
    const maxAttempts = this._config.resilience?.maxAttempts ?? 3;
    const initialDelay = this._config.resilience?.initialDelayMs ?? 1000;
    const maxDelay = this._config.resilience?.maxDelayMs ?? 30000;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        this._connection = await amqplib.connect(this._url);

        // Register mid-session reconnection handlers
        this._connection.on("error", (err: Error) => {
          console.warn("[RabbitMqEventBus] Connection error:", err.message);
        });
        this._connection.on("close", () => {
          if (!this._closed) {
            this._handleUnexpectedClose();
          }
        });

        this._channel = await this._connection.createConfirmChannel();

        // Set prefetch for backpressure control
        await this._channel.prefetch(this._prefetchCount);

        await this._channel.assertExchange(
          this._exchangeName,
          this._exchangeType,
          { durable: true },
        );

        // Activate consumers for handlers registered before connect()
        for (const [eventName] of this._handlers.entries()) {
          await this._setupConsumer(eventName);
        }

        this._connected = true;
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxAttempts - 1) {
          const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError!;
  }

  /**
   * Handles an unexpected connection close (not triggered by close()).
   * Attempts reconnection using the same resilience backoff logic.
   * During reconnection, dispatch() will reject with a connection error.
   * Once reconnected, re-asserts the exchange and re-establishes all consumers.
   */
  private _handleUnexpectedClose(): void {
    if (this._reconnecting) {
      return;
    }
    this._reconnecting = true;
    this._connected = false;

    console.warn(
      "[RabbitMqEventBus] Unexpected disconnection. Attempting reconnection...",
    );

    this._connectWithRetry()
      .then(() => {
        console.warn("[RabbitMqEventBus] Successfully reconnected.");
      })
      .catch((err: Error) => {
        console.error(
          "[RabbitMqEventBus] Reconnection failed after all attempts:",
          err.message,
        );
      })
      .finally(() => {
        this._reconnecting = false;
      });
  }

  /**
   * Registers a handler for a given event name.
   * Binds a queue to the exchange with the event name as routing key.
   * If called before `connect()`, the binding is deferred until `connect()`.
   * Throws if called after `close()`.
   */
  on(eventName: string, handler: AsyncEventHandler): void {
    if (this._closed) {
      throw new Error(
        "RabbitMqEventBus is closed. Cannot register handlers after close().",
      );
    }

    const existing = this._handlers.get(eventName);
    if (existing) {
      // Additional handler for already-subscribed event: append only
      existing.push(handler);
      return;
    }

    // First handler for this event name
    this._handlers.set(eventName, [handler]);

    // If already connected, set up consumer now; otherwise deferred to connect()
    if (this._connected) {
      this._setupConsumer(eventName).catch(() => {
        // Consumer setup failure is non-fatal; the handler is still registered
      });
    }
  }

  /**
   * Publishes an event to the RabbitMQ exchange with the event name as routing key.
   * Serializes the full event as JSON with `{ persistent: true }`.
   * Awaits `channel.waitForConfirms()` to guarantee the broker has accepted the message.
   * Throws if not connected.
   */
  async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    if (!this._connected || !this._channel) {
      throw new Error(
        "RabbitMqEventBus is not connected. Call connect() before dispatch().",
      );
    }

    const body = Buffer.from(JSON.stringify(event));
    this._channel.publish(this._exchangeName, event.name, body, {
      persistent: true,
    });
    await this._channel.waitForConfirms();
  }

  /**
   * Closes the channel and connection, clears handlers.
   * Idempotent: calling multiple times has no additional effect.
   */
  async close(): Promise<void> {
    if (!this._connected) {
      return;
    }

    this._connected = false;
    this._closed = true;
    this._handlers.clear();

    if (this._channel) {
      try {
        await this._channel.close();
      } catch {
        // Ignore errors on close
      }
      this._channel = null;
    }

    if (this._connection) {
      try {
        await this._connection.close();
      } catch {
        // Ignore errors on close
      }
      this._connection = null;
    }
  }

  /**
   * Handles an incoming message by deserializing it and invoking all
   * registered handlers for the event name concurrently via `Promise.all`.
   * Exposed as a semi-private method to allow test injection.
   *
   * Wraps JSON.parse in try/catch to protect against poison messages:
   * if deserialization fails, the error is logged and the method resolves
   * (caller is expected to ack the message to prevent infinite redelivery).
   *
   * If any handler rejects, the error propagates (message will be nacked).
   * @internal
   */
  async _handleMessage(
    eventName: string,
    content: Buffer,
  ): Promise<{ poisoned: boolean }> {
    let event: Event;
    try {
      event = JSON.parse(content.toString()) as Event;
    } catch (err) {
      console.warn(
        `[RabbitMqEventBus] Failed to deserialize message for event "${eventName}". Skipping (ack). Error:`,
        err,
      );
      return { poisoned: true };
    }

    const handlers = this._handlers.get(eventName) ?? [];
    await Promise.all(handlers.map((handler) => handler(event)));
    return { poisoned: false };
  }

  /**
   * Sets up a durable queue and consumer for the given event name.
   * Binds the queue to the exchange with the event name as routing key.
   *
   * If `resilience.maxRetries` is configured, tracks delivery attempts
   * using the `x-death` header count. Messages exceeding the limit are
   * acknowledged and discarded to prevent poison message loops.
   */
  private async _setupConsumer(eventName: string): Promise<void> {
    if (!this._channel) {
      return;
    }

    const queueName = `${this._queuePrefix}.${eventName}`;
    const maxRetries = this._config.resilience?.maxRetries;

    await this._channel.assertQueue(queueName, { durable: true });
    await this._channel.bindQueue(queueName, this._exchangeName, eventName);

    await this._channel.consume(queueName, async (msg) => {
      if (!msg) return;

      // Check delivery count against maxRetries if configured
      if (maxRetries !== undefined) {
        const xDeath = msg.properties.headers?.["x-death"];
        const deliveryCount = Array.isArray(xDeath)
          ? xDeath.reduce(
              (sum: number, entry: { count?: number }) =>
                sum + (entry.count ?? 0),
              0,
            )
          : 0;

        if (deliveryCount > maxRetries) {
          console.warn(
            `[RabbitMqEventBus] Message for "${eventName}" exceeded maxRetries (${maxRetries}). Discarding.`,
          );
          this._channel?.ack(msg);
          return;
        }
      }

      try {
        const result = await this._handleMessage(eventName, msg.content);
        // Always ack: either successful processing or poison message (deserialization failure)
        this._channel?.ack(msg);
        void result;
      } catch {
        this._channel?.nack(msg, false, true);
      }
    });
  }
}
