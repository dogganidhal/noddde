import { Event } from "./event";

/**
 * Publishes domain events to all registered listeners (projections, event handlers).
 * The event bus is the backbone of the read-side update mechanism in CQRS.
 *
 * @see {@link EventEmitterEventBus} for the built-in in-memory implementation.
 */
export interface EventBus {
  /** Publishes a single domain event to all subscribers. */
  dispatch<TEvent extends Event>(event: TEvent): Promise<void>;
}
