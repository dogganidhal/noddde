import {
  connect,
  consumerOpts,
  createInbox,
  headers,
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
import type { Event, Instrumentation } from "@noddde/core";
import { NoopInstrumentation } from "@noddde/core";
import { NodddeLogger } from "@noddde/engine";

// ponytail: fixed backoff ceiling for nak redelivery; make configurable via
// resilience if a real workload needs a different curve.
const NAK_BASE_DELAY_MS = 500;
const NAK_MAX_DELAY_MS = 30_000;

/** Configuration for the NatsEventBus. */
export interface NatsEventBusConfig {
  /** NATS server URL(s) (e.g., "localhost:4222" or ["nats://host1:4222", "nats://host2:4222"]). */
  servers: string | string[];
  /**
   * Consumer group identity. Used both as the prefix for JetStream durable consumer names
   * and as the JetStream deliver/queue group. Two services with different consumerGroup
   * values independently consume the same stream without stealing each other's messages.
   * Multiple bus instances (replicas) sharing the same consumerGroup for the same event
   * bind to the same durable as competing consumers (queue group semantics) — the stream's
   * messages are split across them, not duplicated. Analogous to Kafka's groupId.
   */
  consumerGroup: string;
  /** JetStream stream name for durable subscriptions (e.g., "noddde-events"). */
  streamName?: string;
  /**
   * Prefix prepended to event names to form subject names (e.g., "noddde." → "noddde.AccountCreated").
   * Optional for dispatch/subscribe subject naming. **Required** when `streamName` is also
   * configured and the stream doesn't exist yet — without a prefix, the stream would be
   * created with the subject ">", claiming every subject on the server. A prefix without a
   * trailing "." (e.g. "myapp") is normalized to end with "." before being used to compute
   * stream subjects.
   */
  subjectPrefix?: string;
  /** Maximum number of unacknowledged messages per consumer (default: 256). Provides backpressure control. */
  prefetchCount?: number;
  /** Connection resilience configuration (default: maxAttempts=-1/infinite, initialDelayMs=2000). NATS uses fixed intervals — maxDelayMs is ignored. */
  resilience?: BrokerResilience;
  /** Framework logger instance. Defaults to NodddeLogger("warn", "noddde:nats") from @noddde/engine. */
  logger?: Logger;
  /**
   * OpenTelemetry instrumentation used to enrich per-handler error logs with
   * `traceId`/`spanId` correlation fields. Defaults to a no-op instance.
   */
  instrumentation?: Instrumentation;
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
  private readonly _instrumentation: Instrumentation;
  private _nc: NatsConnection | null = null;
  private _js: JetStreamClient | null = null;
  private _connected: boolean = false;
  private readonly _handlers: Map<string, AsyncEventHandler[]> = new Map();
  private readonly _subscribedEventNames: Set<string> = new Set();
  private _closed: boolean = false;

  constructor(config: NatsEventBusConfig) {
    this._config = config;
    this._logger = config.logger ?? new NodddeLogger("warn", "noddde:nats");
    this._instrumentation = config.instrumentation ?? new NoopInstrumentation();
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

    // If already connected and this event name isn't subscribed yet, create a
    // subscription immediately (late registration — log errors, don't crash).
    // Already-subscribed event names just get the new handler added to the
    // registry above; _handleMessage fans out to it from the existing subscription.
    if (
      this._connected &&
      this._js &&
      !this._subscribedEventNames.has(eventName)
    ) {
      this._subscribedEventNames.add(eventName);
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
    this._subscribedEventNames.clear();
  }

  /**
   * Handles an incoming NATS message for the given event name.
   * Deserializes the message, invokes all registered handlers concurrently via `Promise.allSettled()`.
   * After all handlers settle, logs each rejection individually via the framework Logger. If at least
   * one handler rejected, re-throws the first rejection's reason so the outer consumer loop naks the
   * message (enabling redelivery). All sibling handlers ran to completion before the re-throw.
   * Exposed as a semi-private method for testability.
   *
   * @param eventName - The event name (used to look up handlers).
   * @param messageData - Raw JSON string from the NATS message.
   */
  async _handleMessage(eventName: string, messageData: string): Promise<void> {
    const event = JSON.parse(messageData) as Event;
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

        this._logger.error(`Handler error for event "${event.name}"`, {
          eventName: event.name,
          ...(event.metadata?.eventId !== undefined && {
            eventId: event.metadata.eventId,
          }),
          handlerName,
          error: errorFields,
          ...(traceId !== undefined && { traceId }),
          ...(spanId !== undefined && { spanId }),
        });

        if (firstRejection === undefined) {
          firstRejection = err;
        }
      }
    }

    if (firstRejection !== undefined) {
      throw firstRejection;
    }
  }

  private _subjectFor(eventName: string): string {
    const prefix = this._config.subjectPrefix ?? "";
    return `${prefix}${eventName}`;
  }

  private _dlqSubjectFor(eventName: string): string {
    const prefix = this._config.subjectPrefix ?? "";
    return `${prefix}dlq.${eventName}`;
  }

  private _computeNakDelayMs(deliveryCount: number): number {
    const backoffMs = NAK_BASE_DELAY_MS * 2 ** Math.max(0, deliveryCount - 1);
    return Math.min(backoffMs, NAK_MAX_DELAY_MS);
  }

  /**
   * Publishes an exhausted-retry message to its dead-letter subject with
   * failure metadata, before the message is termed. Best-effort: a DLQ
   * publish failure is logged, not thrown, so it never blocks message
   * termination.
   */
  private async _publishToDeadLetter(
    eventName: string,
    raw: Uint8Array,
    deliveryCount: number,
    error: unknown,
  ): Promise<void> {
    if (!this._js) {
      return;
    }
    const hdrs = headers();
    hdrs.set("noddde-original-subject", this._subjectFor(eventName));
    hdrs.set("noddde-delivery-count", String(deliveryCount));
    hdrs.set(
      "noddde-failure-reason",
      error instanceof Error ? error.message : String(error),
    );
    try {
      await this._js.publish(this._dlqSubjectFor(eventName), raw, {
        headers: hdrs,
      });
    } catch (dlqErr) {
      this._logger.error("Failed to publish message to dead-letter subject", {
        eventName,
        error: String(dlqErr),
      });
    }
  }

  private _buildSubjectsForStream(): string[] {
    const prefix = this._config.subjectPrefix;
    if (!prefix) {
      throw new Error(
        'NatsEventBus: "subjectPrefix" is required when "streamName" is configured. ' +
          'An unset subjectPrefix would create a stream claiming ">" — every subject ' +
          'on the server. Provide a namespaced prefix (e.g. subjectPrefix: "myapp.").',
      );
    }
    const normalized = prefix.endsWith(".") ? prefix : `${prefix}.`;
    const subject = `${normalized}>`;
    if (subject === ">" || /[*>]/.test(normalized)) {
      throw new Error(
        `NatsEventBus: computed stream subject "${subject}" is invalid or overly broad.`,
      );
    }
    return [subject];
  }

  /**
   * Activates subscriptions for all buffered handlers.
   * Throws immediately if any subscription creation fails (fail-fast during connect).
   */
  private async _activateSubscriptions(): Promise<void> {
    for (const eventName of this._handlers.keys()) {
      this._subscribedEventNames.add(eventName);
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
    // Queue group equal to the durable name: replicas sharing the same
    // consumerGroup bind to the same durable as competing consumers instead
    // of the second binder being rejected with "duplicate subscription".
    opts.deliverGroup(durableName);
    opts.manualAck();
    opts.filterSubject(subject);
    opts.maxAckPending(this._config.prefetchCount ?? 256);
    // NATS Server >= 2.10 requires push consumers to declare an explicit
    // deliver subject. We use a per-subscription inbox so two parallel
    // subscribers in the same process don't collide.
    opts.deliverTo(createInbox());

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
        this._logger.error("Handler error for event", {
          eventName,
          error: String(err),
        });

        const deliveryCount = msg.info?.deliveryCount ?? 1;
        const maxRetries = this._config.resilience?.maxRetries;

        if (maxRetries !== undefined && deliveryCount >= maxRetries) {
          await this._publishToDeadLetter(
            eventName,
            msg.data,
            deliveryCount,
            err,
          );
          try {
            msg.term();
          } catch (termErr) {
            this._logger.warn(
              "Failed to term exhausted-retry message (connection dropped?)",
              { eventName, error: String(termErr) },
            );
          }
          continue;
        }

        // Handler failure — request redelivery via nak() with a backoff
        // delay derived from the delivery count, to avoid a hot retry loop.
        try {
          msg.nak(this._computeNakDelayMs(deliveryCount));
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
