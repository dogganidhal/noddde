import { Event, EventBus } from "../../edd";
import { EventEmitter } from "node:events";

/**
 * In-memory {@link EventBus} implementation backed by Node.js `EventEmitter`.
 * Events are dispatched synchronously within the same process.
 *
 * Suitable for development, testing, and single-process applications.
 * For production multi-process deployments, use a message broker (Kafka, RabbitMQ, etc.).
 */
export class EventEmitterEventBus implements EventBus {
  private readonly underlying = new EventEmitter();

  public async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    this.underlying.emit(event.name, event.payload);
  }
}
