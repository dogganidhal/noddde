export { nodddeEvents, nodddeAggregateStates, nodddeSagaStates } from "./schema";
export {
  DrizzleEventSourcedAggregatePersistence,
  DrizzleStateStoredAggregatePersistence,
  DrizzleSagaPersistence,
} from "./persistence";
export { DrizzleUnitOfWork, createDrizzleUnitOfWorkFactory } from "./unit-of-work";
export type { DrizzleTransactionStore } from "./unit-of-work";

import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { UnitOfWorkFactory } from "@noddde/core";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
} from "@noddde/core";
import {
  DrizzleEventSourcedAggregatePersistence,
  DrizzleStateStoredAggregatePersistence,
  DrizzleSagaPersistence,
} from "./persistence";
import { createDrizzleUnitOfWorkFactory } from "./unit-of-work";
import type { DrizzleTransactionStore } from "./unit-of-work";

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
}

/**
 * Creates a complete set of Drizzle-backed persistence implementations
 * sharing a single transaction context. Pass the returned objects directly
 * to `configureDomain()`.
 *
 * @param db - A Drizzle database instance (any dialect: SQLite, PostgreSQL, MySQL).
 * @returns Persistence implementations and a UoW factory.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/better-sqlite3";
 * import Database from "better-sqlite3";
 * import { createDrizzlePersistence } from "@noddde/drizzle";
 *
 * const sqlite = new Database("app.db");
 * const db = drizzle(sqlite);
 * const infra = createDrizzlePersistence(db);
 *
 * const domain = await configureDomain({
 *   writeModel: { aggregates: { MyAggregate } },
 *   readModel: { projections: {} },
 *   infrastructure: {
 *     aggregatePersistence: () => infra.eventSourcedPersistence,
 *     sagaPersistence: () => infra.sagaPersistence,
 *     unitOfWorkFactory: () => infra.unitOfWorkFactory,
 *   },
 * });
 * ```
 */
export function createDrizzlePersistence(
  db: BaseSQLiteDatabase<any, any>,
): DrizzlePersistenceInfrastructure {
  const txStore: DrizzleTransactionStore = { current: null };

  return {
    eventSourcedPersistence: new DrizzleEventSourcedAggregatePersistence(db, txStore),
    stateStoredPersistence: new DrizzleStateStoredAggregatePersistence(db, txStore),
    sagaPersistence: new DrizzleSagaPersistence(db, txStore),
    unitOfWorkFactory: createDrizzleUnitOfWorkFactory(db, txStore),
  };
}
