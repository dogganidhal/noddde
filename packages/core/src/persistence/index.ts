/* eslint-disable no-unused-vars */
import type { ID } from "../id";
import type { Event } from "../edd";

export { ConcurrencyError } from "./concurrency-error";
export type { AggregateLocker } from "./aggregate-locker";
export { LockTimeoutError } from "./lock-timeout-error";
export { fnv1a64 } from "./hash";
export { everyNEvents } from "./snapshot";
export type {
  Snapshot,
  SnapshotStore,
  SnapshotStrategy,
  PartialEventLoad,
} from "./snapshot";
export type { IdempotencyRecord, IdempotencyStore } from "./idempotency";

/**
 * Persistence strategy that stores the current aggregate state directly.
 * On load, the latest snapshot and version are returned. On save, the full
 * state is overwritten after an optimistic concurrency check.
 *
 * Simpler than event sourcing but does not preserve event history.
 *
 * @see {@link EventSourcedAggregatePersistence} for the event-sourcing alternative.
 */
export interface StateStoredAggregatePersistence {
  /**
   * Persists the current state snapshot for an aggregate instance.
   * Throws {@link ConcurrencyError} if `expectedVersion` does not match
   * the current stored version.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param state - The full aggregate state to persist.
   * @param expectedVersion - The version observed at load time. Must match
   *   the current stored version (0 for new aggregates).
   */
  save(
    aggregateName: string,
    aggregateId: ID,
    state: any,
    expectedVersion: number,
  ): Promise<void>;

  /**
   * Loads the latest state snapshot and version for an aggregate instance.
   * Returns `null` if the aggregate does not exist (version is implicitly 0).
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   */
  load(
    aggregateName: string,
    aggregateId: ID,
  ): Promise<{ state: any; version: number } | null>;
}

/**
 * Persistence strategy that stores domain events as the source of truth.
 * On load, the full event stream for an aggregate is returned. On save,
 * new events are appended to the stream after an optimistic concurrency check.
 *
 * The version is implicitly `events.length` (the stream length).
 *
 * @see {@link StateStoredAggregatePersistence} for the state-snapshot alternative.
 */
export interface EventSourcedAggregatePersistence {
  /**
   * Appends new events to the event stream of an aggregate instance.
   * Throws {@link ConcurrencyError} if `expectedVersion` does not match
   * the current stream length.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param events - The new events to append.
   * @param expectedVersion - The stream length observed at load time.
   */
  save(
    aggregateName: string,
    aggregateId: ID,
    events: Event[],
    expectedVersion: number,
  ): Promise<void>;

  /**
   * Loads the full event stream for an aggregate instance.
   * Returns an empty array if the aggregate does not exist.
   * The version is derived as `events.length` by the caller.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   */
  load(aggregateName: string, aggregateId: string): Promise<Event[]>;
}

/**
 * Union of the two aggregate persistence strategies.
 * Used in {@link DomainConfiguration} to allow either approach.
 */
export type PersistenceConfiguration =
  | StateStoredAggregatePersistence
  | EventSourcedAggregatePersistence;

/**
 * Persistence strategy for saga instance state. Each saga instance is
 * identified by a (sagaName, sagaId) pair, analogous to aggregate
 * persistence.
 *
 * Sagas use state-stored persistence (not event-sourced) because they
 * track workflow progress, not domain truth.
 */
export * from "./unit-of-work";

export interface SagaPersistence {
  /**
   * Persists the current state of a saga instance.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   * @param state - The full saga state to persist.
   */
  save(sagaName: string, sagaId: ID, state: any): Promise<void>;

  /**
   * Loads the current state of a saga instance.
   * Returns `undefined` or `null` if no saga instance exists.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   */
  load(sagaName: string, sagaId: string): Promise<any | undefined | null>;
}
