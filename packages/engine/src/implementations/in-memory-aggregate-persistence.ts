import type {
  Event,
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
} from "@noddde/core";
import { ConcurrencyError } from "@noddde/core";

/**
 * In-memory {@link EventSourcedAggregatePersistence} implementation that stores
 * event streams in a `Map`. Events are lost when the process exits.
 *
 * Events are keyed by a composite `${aggregateName}:${aggregateId}` string.
 * Each `save` call **appends** events to the existing stream after verifying
 * `expectedVersion` matches the current stream length. `load` returns all
 * events in insertion order, or an empty array if no events exist.
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
   * The version is implicitly `events.length`.
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
   * Throws {@link ConcurrencyError} if `expectedVersion` does not match
   * the current stream length. Saving an empty array is a no-op.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param events - The new events to append.
   * @param expectedVersion - The stream length observed at load time.
   */
  public async save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
    expectedVersion: number,
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const key = `${aggregateName}:${aggregateId}`;
    const existing = this.store.get(key) ?? [];
    if (existing.length !== expectedVersion) {
      throw new ConcurrencyError(
        aggregateName,
        aggregateId,
        expectedVersion,
        existing.length,
      );
    }
    if (this.store.has(key)) {
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
 * Each `save` call **overwrites** the previously stored state after verifying
 * `expectedVersion` matches the stored version. `load` returns the latest
 * state and version, or `null` if no state exists.
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable store (PostgreSQL, MongoDB, etc.).
 */
export class InMemoryStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  private readonly store = new Map<string, { state: any; version: number }>();

  /**
   * Loads the latest state snapshot and version for an aggregate instance.
   * Returns `null` if no state has been saved for the given key.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @returns The stored `{ state, version }`, or `null` if not found.
   */
  public async load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number } | null> {
    const key = `${aggregateName}:${aggregateId}`;
    return this.store.get(key) ?? null;
  }

  /**
   * Persists the current state snapshot for an aggregate instance,
   * replacing any previously stored state. Throws {@link ConcurrencyError}
   * if `expectedVersion` does not match the stored version.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param state - The full aggregate state to persist.
   * @param expectedVersion - The version observed at load time (0 for new aggregates).
   */
  public async save(
    aggregateName: string,
    aggregateId: string,
    state: any,
    expectedVersion: number,
  ): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    const existing = this.store.get(key);
    const actualVersion = existing?.version ?? 0;
    if (actualVersion !== expectedVersion) {
      throw new ConcurrencyError(
        aggregateName,
        aggregateId,
        expectedVersion,
        actualVersion,
      );
    }
    this.store.set(key, { state, version: expectedVersion + 1 });
  }
}
