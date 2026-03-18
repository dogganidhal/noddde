import { Event } from "../../edd";
import {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
} from "../domain";

/**
 * In-memory {@link EventSourcedAggregatePersistence} implementation that stores
 * event streams in a `Map`. Events are lost when the process exits.
 *
 * Events are keyed by a composite `${aggregateName}:${aggregateId}` string.
 * Each `save` call **appends** events to the existing stream (it does not
 * overwrite). `load` returns all events in insertion order, or an empty
 * array if no events exist for the given aggregate.
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable event store (PostgreSQL, EventStoreDB, etc.).
 */
export class InMemoryEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence
{
  private readonly store = new Map<string, Event[]>();

  /**
   * Loads the full event stream for an aggregate instance.
   * Returns an empty array if no events have been saved for the given key.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @returns The event stream in insertion order, or `[]` if not found.
   */
  public async load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<Event[]> {
    const key = `${aggregateName}:${aggregateId}`;
    return this.store.get(key) ?? [];
  }

  /**
   * Appends new events to the event stream of an aggregate instance.
   * If no stream exists, a new one is created. Saving an empty array is a no-op.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param events - The new events to append.
   */
  public async save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const key = `${aggregateName}:${aggregateId}`;
    const existing = this.store.get(key);
    if (existing) {
      existing.push(...events);
    } else {
      this.store.set(key, [...events]);
    }
  }
}

/**
 * In-memory {@link StateStoredAggregatePersistence} implementation that stores
 * state snapshots in a `Map`. State is lost when the process exits.
 *
 * State is keyed by a composite `${aggregateName}:${aggregateId}` string.
 * Each `save` call **overwrites** the previously stored state. `load` returns
 * the latest state, or `undefined` if no state exists for the given aggregate.
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable store (PostgreSQL, MongoDB, etc.).
 */
export class InMemoryStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  private readonly store = new Map<string, any>();

  /**
   * Loads the latest state snapshot for an aggregate instance.
   * Returns `undefined` if no state has been saved for the given key.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @returns The stored state, or `undefined` if not found.
   */
  public async load(aggregateName: string, aggregateId: string): Promise<any> {
    const key = `${aggregateName}:${aggregateId}`;
    return this.store.get(key);
  }

  /**
   * Persists the current state snapshot for an aggregate instance,
   * replacing any previously stored state.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param state - The full aggregate state to persist.
   */
  public async save(
    aggregateName: string,
    aggregateId: string,
    state: any,
  ): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    this.store.set(key, state);
  }
}
