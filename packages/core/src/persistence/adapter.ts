/* eslint-disable no-unused-vars */
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
} from "./index";
import type { UnitOfWorkFactory } from "./unit-of-work";
import type { SnapshotStore } from "./snapshot";
import type { OutboxStore } from "./outbox";
import type { IdempotencyStore } from "./idempotency";
import type { AggregateLocker } from "./aggregate-locker";

/**
 * Standard interface for database persistence adapters.
 *
 * Adapter classes implement this interface and are passed to `wireDomain`
 * via the `persistenceAdapter` property. The engine resolves aggregate
 * persistence, saga persistence, unit-of-work, snapshots, outbox,
 * idempotency, and locking from the adapter when not explicitly wired.
 *
 * Only `unitOfWorkFactory` is required. All other fields are optional
 * and validated at runtime: the engine errors if the domain needs a
 * capability the adapter doesn't provide.
 *
 * Does NOT extend `Closeable`. Adapters that hold resources implement
 * an optional `close()` method, auto-discovered by `isCloseable()`.
 *
 * @see {@link isPersistenceAdapter} for runtime type guard.
 */
export interface PersistenceAdapter {
  /** Factory for creating unit-of-work instances. Required. */
  unitOfWorkFactory: UnitOfWorkFactory;

  /** Shared event-sourced persistence. Optional. */
  eventSourcedPersistence?: EventSourcedAggregatePersistence;

  /** Shared state-stored persistence (default aggregate table). Optional. */
  stateStoredPersistence?: StateStoredAggregatePersistence;

  /** Saga state persistence. Optional — only needed when sagas are defined. */
  sagaPersistence?: SagaPersistence;

  /** Snapshot store for event-sourced aggregates. Optional. */
  snapshotStore?: SnapshotStore;

  /** Outbox store for transactional outbox pattern. Optional. */
  outboxStore?: OutboxStore;

  /** Idempotency store for command deduplication. Optional. */
  idempotencyStore?: IdempotencyStore;

  /** Aggregate locker for pessimistic concurrency. Optional. */
  aggregateLocker?: AggregateLocker;

  /**
   * Optional initialization hook. Called by `Domain.init()` before
   * any other resolution. Use for schema creation, migrations, etc.
   */
  init?(): Promise<void>;

  /**
   * Optional cleanup hook. Auto-discovered by `isCloseable()` and
   * called during `Domain.shutdown()`. Use for connection pool cleanup.
   * Must be idempotent.
   */
  close?(): Promise<void>;
}

/**
 * Runtime type guard for detecting {@link PersistenceAdapter} implementations.
 * Checks for the presence of `unitOfWorkFactory` as a function — the only
 * required field on the interface.
 *
 * @param value - The value to check.
 * @returns `true` if the value satisfies the `PersistenceAdapter` interface.
 */
export function isPersistenceAdapter(
  value: unknown,
): value is PersistenceAdapter {
  return (
    typeof value === "object" &&
    value !== null &&
    "unitOfWorkFactory" in value &&
    typeof (value as Record<string, unknown>).unitOfWorkFactory === "function"
  );
}
