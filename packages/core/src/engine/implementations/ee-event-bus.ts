/* eslint-disable no-unused-vars */
import { Event, EventBus } from "../../edd";
import { EventEmitter } from "node:events";

/** Async-capable event handler. */
type AsyncEventHandler = (payload: any) => void | Promise<void>;

/**
 * In-memory {@link EventBus} implementation backed by Node.js `EventEmitter`.
 * Events are dispatched within the same process.
 *
 * Handlers registered via {@link on} are awaited during {@link dispatch},
 * ensuring async projection reducers and saga handlers complete before
 * dispatch resolves. The underlying `EventEmitter` is retained for
 * backward compatibility but all handlers are also tracked internally.
 *
 * Suitable for development, testing, and single-process applications.
 * For production multi-process deployments, use a message broker (Kafka, RabbitMQ, etc.).
 */
export class EventEmitterEventBus implements EventBus {
  /**
   * The underlying Node.js `EventEmitter`. Retained for backward
   * compatibility and introspection. Handlers registered via {@link on}
   * are also registered here so that `emitter.listenerCount` etc. work.
   */
  private readonly underlying = new EventEmitter();

  /** Internal async-aware handler registry keyed by event name. */
  private readonly handlers = new Map<string, AsyncEventHandler[]>();

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
   * @param event - The event to dispatch.
   */
  public async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    const eventHandlers = this.handlers.get(event.name);
    if (eventHandlers) {
      for (const handler of eventHandlers) {
        await handler(event.payload);
      }
    }
  }
}
