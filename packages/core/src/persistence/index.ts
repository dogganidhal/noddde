/* eslint-disable no-unused-vars */
import type { Event } from "../edd";

/**
 * Persistence strategy that stores the current aggregate state directly.
 * On load, the latest snapshot is returned. On save, the full state is overwritten.
 *
 * Simpler than event sourcing but does not preserve event history.
 *
 * @see {@link EventSourcedAggregatePersistence} for the event-sourcing alternative.
 */
export interface StateStoredAggregatePersistence {
  /**
   * Persists the current state snapshot for an aggregate instance.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param state - The full aggregate state to persist.
   */
  save(aggregateName: string, aggregateId: string, state: any): Promise<void>;

  /**
   * Loads the latest state snapshot for an aggregate instance.
   * Returns `undefined` or `null` if the aggregate does not exist.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   */
  load(aggregateName: string, aggregateId: string): Promise<any>;
}

/**
 * Persistence strategy that stores domain events as the source of truth.
 * On load, the full event stream for an aggregate is returned. On save,
 * new events are appended to the stream.
 *
 * @see {@link StateStoredAggregatePersistence} for the state-snapshot alternative.
 */
export interface EventSourcedAggregatePersistence {
  /**
   * Appends new events to the event stream of an aggregate instance.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param events - The new events to append.
   */
  save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
  ): Promise<void>;

  /**
   * Loads the full event stream for an aggregate instance.
   * Returns an empty array if the aggregate does not exist.
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
export interface SagaPersistence {
  /**
   * Persists the current state of a saga instance.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   * @param state - The full saga state to persist.
   */
  save(sagaName: string, sagaId: string, state: any): Promise<void>;

  /**
   * Loads the current state of a saga instance.
   * Returns `undefined` or `null` if no saga instance exists.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   */
  load(sagaName: string, sagaId: string): Promise<any | undefined | null>;
}
