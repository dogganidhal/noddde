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
export { IdempotencyConflictError } from "./idempotency-conflict-error";
export type { ViewStore, ViewStoreFactory } from "./view-store";
export { createViewStoreFactory } from "./view-store";
export type { OutboxEntry, OutboxStore } from "./outbox";
export type { PersistenceAdapter } from "./adapter";
export { isPersistenceAdapter } from "./adapter";
export type { AggregateStateMapper } from "./aggregate-state-mapper";
export type { EventReader, EventReadOptions } from "./event-reader";

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
   * @param stateVersion - Optional schema-version tag for the `state`
   *   payload shape, distinct from `expectedVersion` (which is the
   *   OCC/stream-position counter). Absent means "implicitly version 1"
   *   (pre-envelope data). Reserved for future state-upcasting support —
   *   no upcasting is performed by the framework as of 1.0.
   */
  save(
    aggregateName: string,
    aggregateId: ID,
    state: any,
    expectedVersion: number,
    stateVersion?: number,
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
  ): Promise<{ state: any; version: number; stateVersion?: number } | null>;
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
  load(aggregateName: string, aggregateId: ID): Promise<Event[]>;
}

/**
 * Union of the two aggregate persistence strategies.
 * Used in domain wiring to allow either approach.
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
 * track workflow progress, not domain truth. Uses the same
 * optimistic-concurrency shape as {@link StateStoredAggregatePersistence}:
 * `load` returns the state alongside its version, and `save` must be given
 * the version observed at load time.
 */
export * from "./unit-of-work";

export interface SagaPersistence {
  /**
   * Persists the current state of a saga instance, replacing any
   * previously stored state. Throws {@link ConcurrencyError} if
   * `expectedVersion` does not match the current stored version.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   * @param state - The full saga state to persist.
   * @param expectedVersion - The version observed at load time. Must match
   *   the current stored version (0 for new saga instances).
   */
  save(
    sagaName: string,
    sagaId: ID,
    state: any,
    expectedVersion: number,
  ): Promise<void>;

  /**
   * Loads the current state and version of a saga instance.
   * Returns `null` if no saga instance exists (version is implicitly 0).
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   */
  load(
    sagaName: string,
    sagaId: ID,
  ): Promise<{ state: any; version: number } | null>;
}
