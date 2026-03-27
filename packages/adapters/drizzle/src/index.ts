/* eslint-disable no-unused-vars */
export { DrizzleAdvisoryLocker } from "./advisory-locker";
import type { UnitOfWorkFactory } from "@noddde/core";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  SnapshotStore,
  OutboxStore,
} from "@noddde/core";
import {
  DrizzleEventSourcedAggregatePersistence,
  DrizzleStateStoredAggregatePersistence,
  DrizzleSagaPersistence,
  DrizzleSnapshotStore,
  DrizzleOutboxStore,
} from "./persistence";
import { createDrizzleUnitOfWorkFactory } from "./unit-of-work";

export { DrizzleSnapshotStore, DrizzleOutboxStore } from "./persistence";

/**
 * Schema tables the developer passes to the factory.
 * Each field is a Drizzle table definition (any dialect).
 *
 * Import convenience schemas from dialect sub-paths:
 * - `@noddde/drizzle/sqlite`
 * - `@noddde/drizzle/pg`
 * - `@noddde/drizzle/mysql`
 *
 * Or define your own tables matching the expected column structure.
 */
export interface DrizzleNodddeSchema {
  /** Events table with columns: aggregateName, aggregateId, sequenceNumber, eventName, payload, metadata */
  events: any;
  /** Aggregate states table with columns: aggregateName, aggregateId, state, version */
  aggregateStates: any;
  /** Saga states table with columns: sagaName, sagaId, state */
  sagaStates: any;
  /** Snapshots table with columns: aggregateName, aggregateId, state, version. Optional — only needed if using snapshot store. */
  snapshots?: any;
  /** Outbox table with columns: id, event, aggregateName, aggregateId, createdAt, publishedAt. Optional — only needed if using outbox store. */
  outbox?: any;
}

/**
 * Shared transaction store used to propagate the active Drizzle
 * transaction context to persistence implementations. The UoW sets
 * `current` before executing enlisted operations; persistence
 * classes read it to run queries inside the transaction.
 */
export interface DrizzleTransactionStore {
  current: any | null;
}

/**
 * Result of {@link createDrizzlePersistence}, providing all persistence
 * implementations and a UoW factory wired to share a single transaction
 * context.
 */
export interface DrizzlePersistenceInfrastructure {
  /** Event-sourced aggregate persistence backed by Drizzle. */
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  /** State-stored aggregate persistence backed by Drizzle. */
  stateStoredPersistence: StateStoredAggregatePersistence;
  /** Saga persistence backed by Drizzle. */
  sagaPersistence: SagaPersistence;
  /** Factory for creating Drizzle-backed UnitOfWork instances. */
  unitOfWorkFactory: UnitOfWorkFactory;
  /** Snapshot store for event-sourced aggregates. Present only when schema.snapshots is provided. */
  snapshotStore?: SnapshotStore;
  /** Outbox store for the transactional outbox pattern. Present only when schema.outbox is provided. */
  outboxStore?: OutboxStore;
}

/**
 * Creates a complete set of Drizzle-backed persistence implementations
 * sharing a single transaction context. Works with any Drizzle dialect
 * (SQLite, PostgreSQL, MySQL) — the dialect is determined by the `db`
 * instance and `schema` tables you provide.
 *
 * Pass the returned objects to {@link wireDomain} alongside a {@link defineDomain} definition.
 *
 * @param db - A Drizzle database instance (any dialect).
 * @param schema - Table definitions matching the expected column structure.
 *   Import from `@noddde/drizzle/sqlite`, `@noddde/drizzle/pg`, or
 *   `@noddde/drizzle/mysql` for convenience.
 * @returns Persistence implementations and a UoW factory.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/better-sqlite3";
 * import Database from "better-sqlite3";
 * import { createDrizzlePersistence } from "@noddde/drizzle";
 * import { events, aggregateStates, sagaStates } from "@noddde/drizzle/sqlite";
 * import { defineDomain, wireDomain } from "@noddde/engine";
 *
 * const db = drizzle(new Database("app.db"));
 * const infra = createDrizzlePersistence(db, { events, aggregateStates, sagaStates });
 *
 * const definition = defineDomain({
 *   writeModel: { aggregates: { MyAggregate } },
 *   readModel: { projections: {} },
 * });
 *
 * const domain = await wireDomain(definition, {
 *   aggregates: {
 *     persistence: () => infra.eventSourcedPersistence,
 *   },
 *   sagas: {
 *     persistence: () => infra.sagaPersistence,
 *   },
 *   unitOfWork: () => infra.unitOfWorkFactory,
 * });
 * ```
 */
export function createDrizzlePersistence(
  db: any,
  schema: DrizzleNodddeSchema,
): DrizzlePersistenceInfrastructure {
  const txStore: DrizzleTransactionStore = { current: null };

  const result: DrizzlePersistenceInfrastructure = {
    eventSourcedPersistence: new DrizzleEventSourcedAggregatePersistence(
      db,
      txStore,
      schema,
    ),
    stateStoredPersistence: new DrizzleStateStoredAggregatePersistence(
      db,
      txStore,
      schema,
    ),
    sagaPersistence: new DrizzleSagaPersistence(db, txStore, schema),
    unitOfWorkFactory: createDrizzleUnitOfWorkFactory(db, txStore),
  };

  if (schema.snapshots) {
    result.snapshotStore = new DrizzleSnapshotStore(db, txStore, schema);
  }

  if (schema.outbox) {
    result.outboxStore = new DrizzleOutboxStore(db, txStore, schema);
  }

  return result;
}
