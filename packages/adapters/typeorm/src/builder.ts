/* eslint-disable no-unused-vars */
import type { DataSource } from "typeorm";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  SnapshotStore,
  OutboxStore,
  UnitOfWorkFactory,
  AggregateStateMapper,
} from "@noddde/core";
import type { TypeORMTransactionStore } from "./unit-of-work";
import {
  TypeORMEventSourcedAggregatePersistence,
  TypeORMStateStoredAggregatePersistence,
  TypeORMSagaPersistence,
  TypeORMSnapshotStore,
  TypeORMOutboxStore,
} from "./persistence";
import { TypeORMDedicatedStateStoredPersistence } from "./dedicated-state-persistence";
import { createTypeORMUnitOfWorkFactory } from "./unit-of-work";

/**
 * TypeORM-specific bi-directional mapper between an aggregate's state and
 * the state portion of a row on a TypeORM entity. Extends the core
 * AggregateStateMapper with the entity property names the adapter needs
 * at query-construction time.
 *
 * The mapper's toRow / fromRow handle only the state portion of the row;
 * the adapter writes the aggregate id and version itself using the
 * property names provided by aggregateIdField and versionField.
 *
 * @typeParam TState  - The aggregate's state type.
 * @typeParam TEntity - The TypeORM entity instance type.
 */
export interface TypeORMStateMapper<TState, TEntity>
  extends AggregateStateMapper<TState, Partial<TEntity>> {
  /** The entity property name that holds the aggregate instance ID (string PK). */
  readonly aggregateIdField: keyof TEntity & string;
  /** The entity property name that holds the version number (integer). */
  readonly versionField: keyof TEntity & string;
}

/**
 * Configuration for a per-aggregate state table in TypeORM. The mapper is
 * required and is the single source of truth for the row schema.
 *
 * @typeParam TState  - The aggregate's state type.
 * @typeParam TEntity - The TypeORM entity instance type.
 */
export interface TypeORMAggregateStateTableConfig<
  TState = unknown,
  TEntity = any,
> {
  /** The TypeORM entity class for this aggregate's state table. */
  entity: new () => TEntity;
  /** The state mapper. Required — determines how state is read/written to entity columns. */
  mapper: TypeORMStateMapper<TState, TEntity>;
}

/**
 * Configuration for {@link createTypeORMAdapter}.
 *
 * Event store, state store, and saga store are always created (built-in entities).
 * Optional stores (snapshot, outbox) and per-aggregate tables are configured here.
 */
export interface TypeORMAdapterConfig {
  /** Enable the snapshot store (NodddeSnapshotEntity). Optional. */
  snapshotStore?: true;
  /** Enable the outbox store (NodddeOutboxEntryEntity). Optional. */
  outboxStore?: true;
  /** Per-aggregate dedicated state tables with mapper-driven entity mappings. Optional. */
  aggregateStates?: Record<string, TypeORMAggregateStateTableConfig>;
}

/**
 * Result of {@link createTypeORMAdapter}. The type narrows based on which
 * optional stores were configured — configured stores appear as non-optional.
 *
 * Event store, state store, saga store, and UoW are always present.
 *
 * @typeParam C - The adapter config, inferred from the call site.
 */
export type TypeORMAdapterResult<C extends TypeORMAdapterConfig> = {
  /** Shared event-sourced persistence (noddde_events). Always present. */
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  /** Shared state-stored persistence (noddde_aggregate_states). Always present. */
  stateStoredPersistence: StateStoredAggregatePersistence;
  /** Saga persistence (noddde_saga_states). Always present. */
  sagaPersistence: SagaPersistence;
  /** Factory for creating TypeORM-backed UnitOfWork instances. Always present. */
  unitOfWorkFactory: UnitOfWorkFactory;
} & (C extends { snapshotStore: true }
  ? { /** Snapshot store. */ snapshotStore: SnapshotStore }
  : {}) &
  (C extends { outboxStore: true }
    ? { /** Outbox store. */ outboxStore: OutboxStore }
    : {}) &
  (C extends { aggregateStates: Record<string, any> }
    ? {
        /**
         * Returns a {@link StateStoredAggregatePersistence} bound to a dedicated TypeORM entity.
         * @param name - Must be one of the aggregate names configured in `aggregateStates`.
         */
        stateStoreFor(
          name: keyof C["aggregateStates"] & string,
        ): StateStoredAggregatePersistence;
      }
    : {});

/**
 * Creates a fully-configured TypeORM persistence adapter.
 *
 * Event store, state store, saga store, and UoW are always created (built-in
 * entities). The config controls optional stores and per-aggregate tables
 * with mapper-driven entity class mappings.
 *
 * The return type narrows based on the config: only configured optional stores
 * appear in the result, eliminating the need for `!` non-null assertions.
 *
 * @param dataSource - An initialized TypeORM DataSource.
 * @param config - Optional adapter configuration for snapshots, outbox, and per-aggregate tables.
 * @returns Typed persistence infrastructure.
 *
 * @example
 * ```ts
 * import { createTypeORMAdapter, jsonStateMapper } from "@noddde/typeorm";
 * import { OrderEntity } from "./entities";
 *
 * // Minimal — just event store, state store, saga store, UoW
 * const adapter = createTypeORMAdapter(dataSource);
 *
 * // With snapshots and per-aggregate tables
 * const adapter = createTypeORMAdapter(dataSource, {
 *   snapshotStore: true,
 *   aggregateStates: {
 *     Order: { entity: OrderEntity, mapper: jsonStateMapper<OrderEntity>() },
 *   },
 * });
 *
 * adapter.snapshotStore;            // SnapshotStore (non-optional)
 * adapter.stateStoreFor("Order");   // compiles
 * adapter.stateStoreFor("Unknown"); // compile error
 * ```
 */
// eslint-disable-next-line no-redeclare
export function createTypeORMAdapter(
  dataSource: DataSource,
): TypeORMAdapterResult<{}>;
// eslint-disable-next-line no-redeclare
export function createTypeORMAdapter<const C extends TypeORMAdapterConfig>(
  dataSource: DataSource,
  config: C,
): TypeORMAdapterResult<C>;
// eslint-disable-next-line no-redeclare
export function createTypeORMAdapter(
  dataSource: DataSource,
  config?: TypeORMAdapterConfig,
): any {
  const txStore: TypeORMTransactionStore = { current: null };

  const result: Record<string, any> = {
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

  if (config?.snapshotStore) {
    result.snapshotStore = new TypeORMSnapshotStore(dataSource, txStore);
  }

  if (config?.outboxStore) {
    result.outboxStore = new TypeORMOutboxStore(dataSource, txStore);
  }

  if (config?.aggregateStates) {
    const dedicatedStores = new Map<string, StateStoredAggregatePersistence>();

    for (const [name, aggConfig] of Object.entries(config.aggregateStates)) {
      dedicatedStores.set(
        name,
        new TypeORMDedicatedStateStoredPersistence(
          dataSource,
          txStore,
          aggConfig.entity,
          aggConfig.mapper,
        ),
      );
    }

    result.stateStoreFor = (
      aggregateName: string,
    ): StateStoredAggregatePersistence => {
      const store = dedicatedStores.get(aggregateName);
      if (!store) {
        throw new Error(
          `No dedicated state table configured for aggregate "${aggregateName}". ` +
            `Add "${aggregateName}" to the aggregateStates config.`,
        );
      }
      return store;
    };
  }

  return result;
}
