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
  /**
   * Registers an async-capable handler for a given event name. Multiple
   * handlers per name (fan-out).
   *
   * **Late-registration contract:** for a `Connectable` (broker-backed)
   * implementation, registering the *first* handler for an event name
   * that was not already registered before `connect()` was called throws
   * {@link LateSubscriptionError} — this is the one behavior every broker
   * adapter can honor consistently. Registering an *additional* handler
   * for an event name that was already registered pre-connect is ordinary
   * fan-out and never throws. In-memory / non-`Connectable` implementations
   * have no connect phase, so this contract does not restrict them.
   */
  on(eventName: string, handler: AsyncEventHandler): void;
}
