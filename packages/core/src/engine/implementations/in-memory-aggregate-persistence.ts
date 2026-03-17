import { Event } from "../../edd";
import {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
} from "../domain";

/**
 * In-memory {@link EventSourcedAggregatePersistence} implementation that stores
 * event streams in a `Map`. Events are lost when the process exits.
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable event store (PostgreSQL, EventStoreDB, etc.).
 */
export class InMemoryEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence
{
  public async load(aggregateName: string, aggregateId: any): Promise<Event[]> {
    throw new Error("Not implemented");
  }
  public async save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
  ): Promise<void> {
    throw new Error("Not implemented");
  }
}

/**
 * In-memory {@link StateStoredAggregatePersistence} implementation that stores
 * state snapshots in a `Map`. State is lost when the process exits.
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable store (PostgreSQL, MongoDB, etc.).
 */
export class InMemoryStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  public async load(aggregateName: string, aggregateId: any): Promise<any> {
    throw new Error("Not implemented");
  }
  public async save(
    aggregateName: string,
    aggregateId: string,
    state: any,
  ): Promise<void> {
    throw new Error("Not implemented");
  }
}
