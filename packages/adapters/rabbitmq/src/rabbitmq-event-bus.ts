import type {
  AsyncEventHandler,
  BrokerResilience,
  Connectable,
  EventBus,
  Logger,
} from "@noddde/core";
import type { Event } from "@noddde/core";
import { Instrumentation, NodddeLogger } from "@noddde/engine";
import type { ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";
import amqplib from "amqplib";
import { createHash } from "node:crypto";

/** The versioned, stable wire-format content type for published events. */
const EVENT_CONTENT_TYPE = "application/vnd.noddde.event+json; version=1";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * True if `error` is amqplib's PRECONDITION_FAILED specifically for the
 * exchange's `type` argument, which `assertExchange` throws when an exchange
 * already exists with a different type than requested.
 *
 * Only call this on an error caught directly around `assertExchange` —
 * `assertQueue`/`bindQueue` (see `_setupConsumer`) can throw the same
 * PRECONDITION_FAILED code for unrelated queue-argument mismatches. And
 * `assertExchange` itself can throw PRECONDITION_FAILED for *other*
 * inequivalent exchange arguments (durable, autoDelete, arguments) —
 * match the exact "arg 'type'" shape RabbitMQ reports so those don't get
 * mislabeled with "different type" guidance.
 */
function isExchangeTypeMismatch(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    (message.includes("PRECONDITION_FAILED") ||
      message.includes("PRECONDITION-FAILED")) &&
    /inequivalent arg 'type' for exchange/i.test(message)
  );
}

/** Thrown when `assertExchange` fails because of a sticky exchangeType mismatch — not transient, so callers should not retry. */
class ExchangeTypeMismatchError extends Error {
  constructor(exchangeName: string, exchangeType: string, cause: unknown) {
    super(
      `Failed to assert exchange "${exchangeName}": an exchange with this name already ` +
        `exists with a different type than the configured exchangeType ("${exchangeType}"). ` +
        `RabbitMQ exchanges cannot be changed in place — see the "Changing exchangeType after ` +
        `deployment" section in the @noddde/rabbitmq README. Original error: ${errorMessage(cause)}`,
      { cause },
    );
  }
}

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
   * Queue name prefix for consumer queues. **Required** — two different
   * services sharing a prefix become competing consumers on identical
   * queues and each silently loses roughly half its events. Queues are
   * named "${queuePrefix}.${eventName}". Matches Kafka's required
   * `groupId` and NATS's required `consumerGroup`.
   */
  queuePrefix: string;
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
  /**
   * Framework logger instance.
   * Defaults to `new NodddeLogger("warn", "noddde:rabbitmq")` from `@noddde/engine`.
   */
  logger?: Logger;
  /**
   * OpenTelemetry instrumentation used to enrich per-handler error logs with
   * `traceId`/`spanId` correlation fields. Defaults to a no-op instance.
   */
  instrumentation?: Instrumentation;
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
 * const bus = new RabbitMqEventBus({
 *   url: "amqp://localhost:5672",
 *   queuePrefix: "my-service",
 * });
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
  private readonly _logger: Logger;
  private readonly _instrumentation: Instrumentation;

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

  /**
   * In-memory delivery attempt counter keyed by stable message identifier.
   * Used to enforce `resilience.maxRetries` without a dead-letter exchange.
   * Entries are pruned after a successful ack.
   * @internal
   */
  private readonly _deliveryCounts: Map<string, number> = new Map();

  /**
   * Per-aggregateId promise chains used to serialize handler invocation for
   * deliveries that share `event.metadata.aggregateId` within this
   * consumer, even though `channel.consume` may invoke its callback
   * concurrently up to `prefetchCount`. Entries are removed once a chain
   * drains so this map never grows unboundedly.
   * @internal
   */
  private readonly _aggregateChains: Map<string, Promise<void>> = new Map();

  /** Dead-letter exchange name, asserted only when `resilience.maxRetries` is configured. */
  private readonly _dlxName: string;
  /** Dead-letter queue name, bound to `_dlxName`. */
  private readonly _dlqName: string;

  constructor(config: RabbitMqEventBusConfig) {
    this._config = config;
    this._url = config.url;
    this._exchangeName = config.exchangeName ?? "noddde.events";
    this._exchangeType = config.exchangeType ?? "topic";
    this._queuePrefix = config.queuePrefix;
    this._prefetchCount = config.prefetchCount ?? 10;
    this._logger = config.logger ?? new NodddeLogger("warn", "noddde:rabbitmq");
    this._instrumentation = config.instrumentation ?? new Instrumentation(null);
    this._dlxName = `${this._exchangeName}.dlx`;
    this._dlqName = `${this._queuePrefix}.dlq`;
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
      let connection: ChannelModel | undefined;
      try {
        connection = await amqplib.connect(this._url);
        this._connection = connection;

        const channel = await connection.createConfirmChannel();
        this._channel = channel;

        // Set prefetch for backpressure control
        await channel.prefetch(this._prefetchCount);

        try {
          await channel.assertExchange(this._exchangeName, this._exchangeType, {
            durable: true,
          });
        } catch (error) {
          if (isExchangeTypeMismatch(error)) {
            throw new ExchangeTypeMismatchError(
              this._exchangeName,
              this._exchangeType,
              error,
            );
          }
          throw error;
        }

        // Activate consumers for handlers registered before connect()
        for (const [eventName] of this._handlers.entries()) {
          await this._setupConsumer(eventName);
        }

        // Register mid-session reconnection handlers only once setup has
        // fully succeeded. Registering earlier means a failed attempt's
        // own cleanup close() (below) would trigger _handleUnexpectedClose()
        // and spin up a spurious background reconnection loop.
        connection.on("error", (err: Error) => {
          this._logger.warn("Connection error", { error: String(err.message) });
        });
        connection.on("close", () => {
          if (!this._closed) {
            this._handleUnexpectedClose();
          }
        });
        // A channel can be killed independently of the connection (e.g. the
        // broker closes it with PRECONDITION_FAILED after an ack/nack on a
        // stale channel post-reconnect). Only connection-level close would
        // otherwise trigger reconnection, silently wedging every consumer
        // on a dead channel while `_connected` stays true.
        channel.on("error", (err: Error) => {
          this._logger.warn("Channel error", { error: String(err.message) });
        });
        channel.on("close", () => {
          if (!this._closed) {
            this._handleUnexpectedClose();
          }
        });

        this._connected = true;
        return;
      } catch (error) {
        // Setup failed this attempt — close whatever was opened so we don't
        // leak a socket/channel per retry (no reconnection handlers are
        // attached yet, so this can't trigger _handleUnexpectedClose()).
        if (connection) {
          await connection.close().catch(() => {});
        }
        this._connection = null;
        this._channel = null;

        if (error instanceof ExchangeTypeMismatchError) {
          // Not transient: a different exchangeType will never succeed on
          // retry against the same exchangeName. Fail fast with guidance.
          throw error;
        }
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
   * Starts an unbounded reconnection loop that retries indefinitely until
   * `close()` is called. Uses jittered exponential backoff.
   *
   * Unlike `_connectWithRetry()`, this loop ignores `resilience.maxAttempts`
   * — it will keep trying until `_closed` is set to true.
   *
   * During reconnection, dispatch() will reject with a connection error.
   * Once reconnected, re-asserts the exchange and re-establishes all consumers.
   */
  private _handleUnexpectedClose(): void {
    if (this._reconnecting) {
      return;
    }
    this._reconnecting = true;
    this._connected = false;

    this._logger.warn("Unexpected disconnection. Attempting reconnection...", {
      url: this._url,
    });

    this._reconnectPersistently().finally(() => {
      this._reconnecting = false;
    });
  }

  /**
   * Indefinitely retries connecting to RabbitMQ with jittered exponential backoff.
   * Stops when `_closed` becomes true (set by `close()`).
   *
   * Backoff formula:
   *   baseDelay = min(initialDelayMs * 2^attempt, maxDelayMs)
   *   jitteredDelay = baseDelay * (0.75 + Math.random() * 0.5)
   *
   * @internal
   */
  private async _reconnectPersistently(): Promise<void> {
    const initialDelay = this._config.resilience?.initialDelayMs ?? 1000;
    const maxDelay = this._config.resilience?.maxDelayMs ?? 30000;

    let attempt = 0;

    while (!this._closed) {
      try {
        this._connection = await amqplib.connect(this._url);

        // Register mid-session reconnection handlers on the new connection
        this._connection.on("error", (err: Error) => {
          this._logger.warn("Connection error", { error: String(err.message) });
        });
        this._connection.on("close", () => {
          if (!this._closed) {
            this._handleUnexpectedClose();
          }
        });

        this._channel = await this._connection.createConfirmChannel();
        const channel = this._channel;

        // Set prefetch for backpressure control
        await channel.prefetch(this._prefetchCount);

        await channel.assertExchange(this._exchangeName, this._exchangeType, {
          durable: true,
        });

        channel.on("error", (err: Error) => {
          this._logger.warn("Channel error", { error: String(err.message) });
        });
        channel.on("close", () => {
          if (!this._closed) {
            this._handleUnexpectedClose();
          }
        });

        // Re-establish consumers for all registered handlers
        for (const [eventName] of this._handlers.entries()) {
          await this._setupConsumer(eventName);
        }

        this._connected = true;
        attempt = 0; // reset backoff on success
        this._logger.warn("Successfully reconnected.", { url: this._url });
        return;
      } catch (err) {
        if (this._closed) {
          return;
        }

        const baseDelay = Math.min(
          initialDelay * Math.pow(2, attempt),
          maxDelay,
        );
        const jitteredDelay = baseDelay * (0.75 + Math.random() * 0.5);

        this._logger.warn(
          `Reconnect attempt ${attempt + 1} failed. Retrying in ${Math.round(jitteredDelay)}ms...`,
          { error: String((err as Error).message), attempt: attempt + 1 },
        );

        await new Promise((r) => setTimeout(r, jitteredDelay));
        attempt++;

        if (this._closed) {
          return;
        }
      }
    }
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
      this._setupConsumer(eventName).catch((error: unknown) => {
        // Consumer setup failure is non-fatal — the handler is still
        // registered, and the full reconnection path (which unconditionally
        // re-runs _setupConsumer for every registered event name) will
        // retry this the next time the connection cycles.
        this._logger.error(
          `Failed to set up consumer for "${eventName}". Handler remains registered but inactive until the next reconnection.`,
          { eventName, error: String(error) },
        );
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
    const messageId = (event as { metadata?: { eventId?: string } }).metadata
      ?.eventId;
    this._channel.publish(this._exchangeName, event.name, body, {
      persistent: true,
      contentType: EVENT_CONTENT_TYPE,
      ...(messageId !== undefined ? { messageId } : {}),
    });
    await this._channel.waitForConfirms();
  }

  /**
   * Closes the channel and connection, clears handlers.
   * Idempotent: calling multiple times has no additional effect.
   * If a mid-session reconnection is in progress, signals the loop to stop
   * by setting `_closed = true` before returning.
   */
  async close(): Promise<void> {
    if (this._closed) {
      return;
    }

    // Mark closed first — this signals any in-progress reconnection loop to stop
    this._closed = true;
    this._connected = false;
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
   * registered handlers for the event name concurrently via `Promise.allSettled`.
   * Exposed as a semi-private method to allow test injection.
   *
   * Wraps JSON.parse in try/catch to protect against poison messages:
   * if deserialization fails, the error is logged and `{ poisoned: true }` is returned
   * (caller is expected to ack the message to prevent infinite redelivery).
   *
   * After all handlers settle, logs each rejection individually via the framework Logger.
   * If at least one handler rejected, re-throws the first rejection's reason so the outer
   * consume callback nacks the message with requeue. All sibling handlers ran to completion
   * before the re-throw.
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
      this._logger.warn(
        `Failed to deserialize message for event "${eventName}". Skipping (ack).`,
        { eventName, error: String(err) },
      );
      return { poisoned: true };
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

    return { poisoned: false };
  }

  /**
   * Sets up a durable queue and consumer for the given event name.
   * Binds the queue to the exchange with the event name as routing key.
   *
   * Captures the `ConfirmChannel` instance into a local `channel` at
   * subscribe time and uses only that captured instance for every
   * `ack`/`nack` in this consumer's callback — never `this._channel`, which
   * a mid-session reconnect can replace with a different channel whose
   * delivery tags are unrelated to this one's in-flight messages.
   *
   * Deliveries sharing `event.metadata.aggregateId` are serialized via
   * `_aggregateChains` so their handlers run one-at-a-time in delivery
   * order, even though the broker may invoke this callback concurrently up
   * to `prefetchCount`.
   */
  private async _setupConsumer(eventName: string): Promise<void> {
    const channel = this._channel;
    if (!channel) {
      return;
    }

    const queueName = `${this._queuePrefix}.${eventName}`;
    const maxRetries = this._config.resilience?.maxRetries;

    if (maxRetries !== undefined) {
      await this._assertDeadLetterTopology(channel);
    }

    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, this._exchangeName, eventName);

    await channel.consume(queueName, async (msg) => {
      if (!msg) return;

      const aggregateId = this._peekAggregateId(msg.content);
      const process = () =>
        this._processDelivery(channel, eventName, msg, maxRetries);

      if (aggregateId === undefined) {
        await process();
        return;
      }

      const prior = this._aggregateChains.get(aggregateId) ?? Promise.resolve();
      const next = prior.then(process);
      this._aggregateChains.set(aggregateId, next);
      await next;
      if (this._aggregateChains.get(aggregateId) === next) {
        this._aggregateChains.delete(aggregateId);
      }
    });
  }

  /**
   * Best-effort extraction of `event.metadata.aggregateId` from a raw
   * message body, used only to decide same-aggregate serialization.
   * Returns `undefined` on parse failure or absent aggregateId — such
   * deliveries are simply not serialized against anything; `_handleMessage`
   * performs the authoritative parse (and poison-message handling) later.
   */
  private _peekAggregateId(content: Buffer): string | undefined {
    try {
      const event = JSON.parse(content.toString()) as Event;
      const aggregateId = event.metadata?.aggregateId;
      return aggregateId !== undefined ? String(aggregateId) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Processes a single delivery: enforces `maxRetries` (dead-lettering on
   * exhaustion), invokes `_handleMessage`, and acks/nacks on the captured
   * `channel`. Never throws — all failures (handler errors, stale-channel
   * ack/nack errors) are caught and logged internally, so callers (the
   * consumer callback and the per-aggregate promise chain) can rely on this
   * always resolving.
   */
  private async _processDelivery(
    channel: ConfirmChannel,
    eventName: string,
    msg: ConsumeMessage,
    maxRetries: number | undefined,
  ): Promise<void> {
    let retryKey: string | undefined;
    if (maxRetries !== undefined) {
      // A stable messageId survives redelivery, so it is preferred. Without
      // one, hash the *entire* body (never a truncated prefix): same-type
      // events sharing a long common JSON prefix would otherwise hash
      // identically regardless of payload, misclassifying healthy distinct
      // messages as retries of one "poison" key.
      retryKey =
        (msg.properties.messageId as string | undefined) ??
        createHash("sha256").update(msg.content).digest("hex");
      const count = (this._deliveryCounts.get(retryKey) ?? 0) + 1;
      this._deliveryCounts.set(retryKey, count);
      if (count > maxRetries) {
        this._logger.warn(
          `Message for "${eventName}" exceeded maxRetries (${maxRetries}). Dead-lettering.`,
          { eventName, maxRetries, count },
        );
        this._deliveryCounts.delete(retryKey);
        await this._deadLetter(
          channel,
          eventName,
          msg,
          "max-retries-exceeded",
          count,
        );
        return;
      }
    }

    try {
      await this._handleMessage(eventName, msg.content);
      try {
        channel.ack(msg);
      } catch (err) {
        this._logger.warn(
          `Failed to ack message for "${eventName}" on a stale channel; the broker will redeliver.`,
          { eventName, error: String(err) },
        );
      }
      if (retryKey !== undefined) {
        this._deliveryCounts.delete(retryKey);
      }
    } catch {
      try {
        channel.nack(msg, false, true);
      } catch (err) {
        this._logger.warn(
          `Failed to nack message for "${eventName}" on a stale channel; the broker will redeliver.`,
          { eventName, error: String(err) },
        );
      }
    }
  }

  /**
   * Publishes an exhausted-retry message to the dead-letter exchange with
   * failure metadata headers, then acks it off its source queue. Dead-letter
   * publish is best-effort — if it fails, the error is logged and the
   * original message is still acked so it never loops forever.
   */
  private async _deadLetter(
    channel: ConfirmChannel,
    eventName: string,
    msg: ConsumeMessage,
    reason: string,
    attempts: number,
  ): Promise<void> {
    try {
      channel.publish(this._dlxName, eventName, msg.content, {
        persistent: true,
        headers: {
          "x-original-event-name": eventName,
          "x-death-reason": reason,
          "x-attempts": attempts,
          "x-original-timestamp": new Date().toISOString(),
        },
      });
    } catch (err) {
      this._logger.error(
        `Failed to publish dead-lettered message for "${eventName}".`,
        { eventName, error: String(err) },
      );
    }
    try {
      channel.ack(msg);
    } catch (err) {
      this._logger.warn(
        `Failed to ack dead-lettered message for "${eventName}" on a stale channel; the broker will redeliver.`,
        { eventName, error: String(err) },
      );
    }
  }

  /**
   * Asserts the fanout dead-letter exchange and its single catch-all queue.
   * Only called when `resilience.maxRetries` is configured. Idempotent —
   * safe to call once per registered event name.
   */
  private async _assertDeadLetterTopology(
    channel: ConfirmChannel,
  ): Promise<void> {
    await channel.assertExchange(this._dlxName, "fanout", { durable: true });
    await channel.assertQueue(this._dlqName, { durable: true });
    await channel.bindQueue(this._dlqName, this._dlxName, "");
  }
}
