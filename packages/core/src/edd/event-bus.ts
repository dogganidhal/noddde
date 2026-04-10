/* eslint-disable no-unused-vars */
import type { Closeable } from "../infrastructure/closeable";
import type { Event } from "./event";

/** Async-capable event handler that receives the full event object. */
export type AsyncEventHandler = (event: Event) => void | Promise<void>;

/**
 * Publishes domain events to all registered listeners (projections, event handlers, sagas).
 * Extends Closeable so implementations can release connections and subscriptions on shutdown.
 *
 * The event bus is the backbone of the read-side update mechanism in CQRS.
 *
 * @see {@link EventEmitterEventBus} for the built-in in-memory implementation.
 */
export interface EventBus extends Closeable {
  /** Publishes a single domain event to all subscribers. */
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;
  /** Registers an async-capable handler for a given event name. Multiple handlers per name (fan-out). */
  on(eventName: string, handler: AsyncEventHandler): void;
}
