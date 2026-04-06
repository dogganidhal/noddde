export { TypeORMAdapter } from "./typeorm-adapter";
export {
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
  NodddeOutboxEntryEntity,
} from "./entities";
export {
  TypeORMEventSourcedAggregatePersistence,
  TypeORMStateStoredAggregatePersistence,
  TypeORMSagaPersistence,
  TypeORMSnapshotStore,
  TypeORMOutboxStore,
} from "./persistence";
export { TypeORMAdvisoryLocker } from "./advisory-locker";
export {
  TypeORMUnitOfWork,
  createTypeORMUnitOfWorkFactory,
} from "./unit-of-work";
export type { TypeORMTransactionStore } from "./unit-of-work";
export {
  createTypeORMAdapter,
  type TypeORMAdapterConfig,
  type TypeORMAdapterResult,
  type TypeORMAggregateStateTableConfig,
  type TypeORMStateTableColumnMap,
} from "./builder";
export {
  generateTypeORMMigration,
  type TypeORMMigrationOptions,
} from "./migrations";

import type { DataSource } from "typeorm";
import type { UnitOfWorkFactory } from "@noddde/core";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  SnapshotStore,
  OutboxStore,
} from "@noddde/core";
import { createTypeORMAdapter } from "./builder";

/**
 * Result of {@link createTypeORMPersistence}.
 */
export interface TypeORMPersistenceInfrastructure {
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  stateStoredPersistence: StateStoredAggregatePersistence;
  sagaPersistence: SagaPersistence;
  snapshotStore: SnapshotStore;
  outboxStore: OutboxStore;
  unitOfWorkFactory: UnitOfWorkFactory;
}

/**
 * Creates a complete set of TypeORM-backed persistence implementations.
 *
 * @deprecated Use {@link createTypeORMAdapter} instead for new code.
 * This function is preserved for backwards compatibility and delegates
 * to the builder internally.
 *
 * @param dataSource - An initialized TypeORM DataSource.
 * @returns Persistence implementations and a UoW factory.
 *
 * @example
 * ```ts
 * import { DataSource } from "typeorm";
 * import {
 *   createTypeORMPersistence,
 *   NodddeEventEntity,
 *   NodddeAggregateStateEntity,
 *   NodddeSagaStateEntity,
 *   NodddeSnapshotEntity,
 * } from "@noddde/typeorm";
 * import { defineDomain, wireDomain } from "@noddde/engine";
 *
 * const dataSource = new DataSource({
 *   type: "sqlite",
 *   database: ":memory:",
 *   entities: [NodddeEventEntity, NodddeAggregateStateEntity, NodddeSagaStateEntity, NodddeSnapshotEntity],
 *   synchronize: true,
 * });
 * await dataSource.initialize();
 *
 * const infra = createTypeORMPersistence(dataSource);
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
export function createTypeORMPersistence(
  dataSource: DataSource,
): TypeORMPersistenceInfrastructure {
  const result = createTypeORMAdapter(dataSource, {
    snapshotStore: true,
    outboxStore: true,
  });

  return {
    eventSourcedPersistence: result.eventSourcedPersistence,
    stateStoredPersistence: result.stateStoredPersistence,
    sagaPersistence: result.sagaPersistence,
    snapshotStore: result.snapshotStore,
    outboxStore: result.outboxStore,
    unitOfWorkFactory: result.unitOfWorkFactory,
  };
}
