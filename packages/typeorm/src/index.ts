export {
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
} from "./entities";
export {
  TypeORMEventSourcedAggregatePersistence,
  TypeORMStateStoredAggregatePersistence,
  TypeORMSagaPersistence,
} from "./persistence";
export { TypeORMAdvisoryLocker } from "./advisory-locker";
export {
  TypeORMUnitOfWork,
  createTypeORMUnitOfWorkFactory,
} from "./unit-of-work";
export type { TypeORMTransactionStore } from "./unit-of-work";

import type { DataSource } from "typeorm";
import type { UnitOfWorkFactory } from "@noddde/core";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
} from "@noddde/core";
import {
  TypeORMEventSourcedAggregatePersistence,
  TypeORMStateStoredAggregatePersistence,
  TypeORMSagaPersistence,
} from "./persistence";
import { createTypeORMUnitOfWorkFactory } from "./unit-of-work";
import type { TypeORMTransactionStore } from "./unit-of-work";

/**
 * Result of {@link createTypeORMPersistence}.
 */
export interface TypeORMPersistenceInfrastructure {
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  stateStoredPersistence: StateStoredAggregatePersistence;
  sagaPersistence: SagaPersistence;
  unitOfWorkFactory: UnitOfWorkFactory;
}

/**
 * Creates a complete set of TypeORM-backed persistence implementations.
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
 * } from "@noddde/typeorm";
 *
 * const dataSource = new DataSource({
 *   type: "sqlite",
 *   database: ":memory:",
 *   entities: [NodddeEventEntity, NodddeAggregateStateEntity, NodddeSagaStateEntity],
 *   synchronize: true,
 * });
 * await dataSource.initialize();
 *
 * const infra = createTypeORMPersistence(dataSource);
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
export function createTypeORMPersistence(
  dataSource: DataSource,
): TypeORMPersistenceInfrastructure {
  const txStore: TypeORMTransactionStore = { current: null };

  return {
    eventSourcedPersistence: new TypeORMEventSourcedAggregatePersistence(
      dataSource,
      txStore,
    ),
    stateStoredPersistence: new TypeORMStateStoredAggregatePersistence(
      dataSource,
      txStore,
    ),
    sagaPersistence: new TypeORMSagaPersistence(dataSource, txStore),
    unitOfWorkFactory: createTypeORMUnitOfWorkFactory(dataSource, txStore),
  };
}
