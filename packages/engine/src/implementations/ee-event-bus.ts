import type {
  AsyncEventHandler,
  Event,
  EventBus,
  Instrumentation,
  Logger,
} from "@noddde/core";
import { NoopInstrumentation } from "@noddde/core";
import { EventEmitter } from "node:events";
import { NodddeLogger } from "../logger";

/**
 * Configuration for the {@link EventEmitterEventBus}.
 */
export interface EventEmitterEventBusConfig {
  /**
   * Framework logger instance.
   * Defaults to `new NodddeLogger("warn", "noddde:ee-event-bus")`.
   */
  logger?: Logger;
  /**
   * Tracing instrumentation used to enrich error logs with trace correlation IDs.
   * Accepts the `Instrumentation` interface from `@noddde/core` (e.g.
   * `OTelInstrumentation` from `@noddde/engine`). Defaults to a no-op
   * `NoopInstrumentation` instance.
   */
  instrumentation?: Instrumentation;
}

/**
 * In-memory {@link EventBus} implementation backed by Node.js `EventEmitter`.
 * Events are dispatched within the same process.
 *
 * Handlers registered via {@link on} are awaited sequentially during {@link dispatch}.
 * Each handler invocation is wrapped in its own try/catch: a failure (synchronous throw
 * or rejected promise) is caught, logged via the framework {@link Logger} at `error` level
 * with structured fields, and dispatch continues to the next handler. `dispatch` never
 * rejects from a handler failure — it always resolves with `undefined`.
 *
 * Suitable for development, testing, and single-process applications.
 * For production multi-process deployments, use a message broker (Kafka, RabbitMQ, etc.).
 */
export class EventEmitterEventBus implements EventBus {
  /**
   * The underlying Node.js `EventEmitter`. Retained for backward
   * compatibility and introspection.
   */
  private readonly underlying = new EventEmitter();

  /** Internal async-aware handler registry keyed by event name. */
  private readonly handlers = new Map<string, AsyncEventHandler[]>();

  /** Framework logger for structured error logging on handler failures. */
  private readonly _logger: Logger;

  /** OTel instrumentation for trace correlation enrichment on handler failures. */
  private readonly _instrumentation: Instrumentation;

  /**
   * Constructs the bus. Both config fields are optional.
   *
   * @param config - Optional configuration. When omitted, defaults are used for both
   *   `logger` (warn-level NodddeLogger) and `instrumentation` (no-op).
   */
  constructor(config?: EventEmitterEventBusConfig) {
    this._logger =
      config?.logger ?? new NodddeLogger("warn", "noddde:ee-event-bus");
    this._instrumentation =
      config?.instrumentation ?? new NoopInstrumentation();
  }

  /**
   * Registers an async-capable event handler for a given event name.
   *
   * @param eventName - The event name to subscribe to.
   * @param handler - The handler function. May return a `Promise`.
   */
  public on(eventName: string, handler: AsyncEventHandler): void {
    const existing = this.handlers.get(eventName);
    if (existing) {
      existing.push(handler);
    } else {
      this.handlers.set(eventName, [handler]);
    }
  }

  /**
   * Dispatches an event to all registered handlers and awaits their completion.
   *
   * Each handler invocation is wrapped in its own try/catch. A handler that throws
   * (synchronously or via a rejected promise) is caught, logged at `error` level with
   * structured fields (`eventName`, `eventId`, `handlerName`, `error`, and optional
   * `traceId`/`spanId`), and dispatch continues to the next handler. `dispatch` always
   * resolves with `undefined` — it never rejects due to a handler failure.
   *
   * @param event - The event to dispatch.
   */
  public async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    const eventHandlers = this.handlers.get(event.name);
    if (!eventHandlers) {
      return;
    }

    for (const handler of eventHandlers) {
      try {
        await handler(event);
      } catch (err: unknown) {
        const { traceId, spanId } =
          this._instrumentation.getActiveTraceCorrelation();

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
      }
    }
  }

  /**
   * Removes a previously registered handler for the given event name.
   * No-op if the handler is not currently registered.
   *
   * Used by {@link Domain.rebuildProjection} to detach projection
   * subscriptions during the replay window.
   */
  public off(eventName: string, handler: AsyncEventHandler): void {
    const existing = this.handlers.get(eventName);
    if (!existing) return;
    const idx = existing.indexOf(handler);
    if (idx !== -1) {
      existing.splice(idx, 1);
    }
  }

  /**
   * Releases all resources: clears all registered handlers.
   * After calling `close()`, dispatching any event is a no-op.
   * Idempotent: subsequent calls resolve immediately.
   */
  public async close(): Promise<void> {
    this.removeAllListeners();
  }

  /**
   * Removes all registered handlers for all event names.
   * Called internally by {@link close} during domain shutdown to prevent
   * event delivery to stale handlers after infrastructure is closed.
   */
  private removeAllListeners(): void {
    this.handlers.clear();
    this.underlying.removeAllListeners();
  }
}
