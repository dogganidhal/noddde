/* eslint-disable no-unused-vars */
import type { DataSource, EntityManager } from "typeorm";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  SnapshotStore,
  OutboxStore,
  UnitOfWorkFactory,
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
import {
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
  NodddeOutboxEntryEntity,
} from "./entities";

/**
 * Column mapping for a custom state-stored aggregate table in TypeORM.
 * Maps logical noddde columns to TypeORM entity property names.
 * Defaults: `{ aggregateId: "aggregateId", state: "state", version: "version" }`.
 */
export interface TypeORMStateTableColumnMap {
  /** Property name holding the aggregate instance ID (string PK). */
  aggregateId: string;
  /** Property name holding the serialized aggregate state (text). */
  state: string;
  /** Property name holding the version number (integer). */
  version: string;
}

/**
 * Configuration for a per-aggregate state table in TypeORM.
 */
export interface TypeORMAggregateStateTableConfig {
  /** The TypeORM entity class for this aggregate's state table. */
  entity: Function;
  /** Column mappings. If omitted, uses defaults: aggregateId, state, version. */
  columns?: Partial<TypeORMStateTableColumnMap>;
}

/**
 * Result of {@link TypeORMAdapter.build}. Provides all persistence
 * implementations, a UoW factory, and per-aggregate state store access.
 */
export interface TypeORMAdapterResult {
  /** Shared event-sourced persistence (noddde_events table). */
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  /**
   * Shared state-stored persistence (noddde_aggregate_states table).
   * Undefined if {@link TypeORMAdapter.withStateStore} was not called.
   */
  stateStoredPersistence?: StateStoredAggregatePersistence;
  /** Saga persistence (always shared table). */
  sagaPersistence: SagaPersistence;
  /** Factory for creating TypeORM-backed UnitOfWork instances. */
  unitOfWorkFactory: UnitOfWorkFactory;
  /** Snapshot store. Present only when {@link TypeORMAdapter.withSnapshotStore} was called. */
  snapshotStore?: SnapshotStore;
  /** Outbox store. Present only when {@link TypeORMAdapter.withOutboxStore} was called. */
  outboxStore?: OutboxStore;
  /**
   * Returns a {@link StateStoredAggregatePersistence} bound to a specific
   * aggregate's dedicated TypeORM entity. Throws if no such aggregate was
   * configured via {@link TypeORMAdapter.withAggregateStateTable}.
   *
   * @param aggregateName - The aggregate name as registered with `withAggregateStateTable`.
   * @throws If the aggregate was not configured.
   */
  stateStoreFor(aggregateName: string): StateStoredAggregatePersistence;
}

const DEFAULT_COLUMNS: TypeORMStateTableColumnMap = {
  aggregateId: "aggregateId",
  state: "state",
  version: "version",
};

/**
 * Builder for constructing a fully-configured TypeORM persistence layer.
 * Supports shared tables (existing behavior) plus per-aggregate
 * dedicated state tables with custom column mappings.
 *
 * All persistence instances created by a single builder share the same
 * {@link TypeORMTransactionStore}, ensuring UoW atomicity.
 *
 * @example
 * ```ts
 * import { TypeORMAdapter, NodddeEventEntity, NodddeSagaStateEntity } from "@noddde/typeorm";
 * import { OrderEntity } from "./entities";
 *
 * const adapter = new TypeORMAdapter(dataSource)
 *   .withEventStore()
 *   .withSagaStore()
 *   .withSnapshotStore()
 *   .withAggregateStateTable("Order", { entity: OrderEntity })
 *   .build();
 *
 * const orderPersistence = adapter.stateStoreFor("Order");
 * ```
 */
export class TypeORMAdapter {
  private _eventStoreEntity: Function | undefined;
  private _stateStoreEntity: Function | undefined;
  private _sagaStoreEntity: Function | undefined;
  private _snapshotStoreEntity: Function | undefined;
  private _outboxStoreEntity: Function | undefined;
  private _aggregateStateTables = new Map<
    string,
    TypeORMAggregateStateTableConfig
  >();

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Configures the shared event store.
   * Required for {@link build}.
   *
   * @param entity - TypeORM entity class. Defaults to {@link NodddeEventEntity}.
   */
  withEventStore(entity?: Function): this {
    this._eventStoreEntity = entity ?? NodddeEventEntity;
    return this;
  }

  /**
   * Configures the shared aggregate state store.
   * Optional — only needed if some aggregates use the shared table.
   *
   * @param entity - TypeORM entity class. Defaults to {@link NodddeAggregateStateEntity}.
   */
  withStateStore(entity?: Function): this {
    this._stateStoreEntity = entity ?? NodddeAggregateStateEntity;
    return this;
  }

  /**
   * Configures the saga state store.
   * Required for {@link build}.
   *
   * @param entity - TypeORM entity class. Defaults to {@link NodddeSagaStateEntity}.
   */
  withSagaStore(entity?: Function): this {
    this._sagaStoreEntity = entity ?? NodddeSagaStateEntity;
    return this;
  }

  /**
   * Configures the snapshot store.
   * Optional.
   *
   * @param entity - TypeORM entity class. Defaults to {@link NodddeSnapshotEntity}.
   */
  withSnapshotStore(entity?: Function): this {
    this._snapshotStoreEntity = entity ?? NodddeSnapshotEntity;
    return this;
  }

  /**
   * Configures the outbox store.
   * Optional.
   *
   * @param entity - TypeORM entity class. Defaults to {@link NodddeOutboxEntryEntity}.
   */
  withOutboxStore(entity?: Function): this {
    this._outboxStoreEntity = entity ?? NodddeOutboxEntryEntity;
    return this;
  }

  /**
   * Maps an aggregate to a dedicated state table. The persistence
   * instance returned by {@link TypeORMAdapterResult.stateStoreFor}
   * will query/write this specific TypeORM entity instead of the shared
   * `noddde_aggregate_states`.
   *
   * @param aggregateName - The aggregate name (must match the name used in domain definition).
   * @param config - TypeORM entity class and optional column mappings.
   */
  withAggregateStateTable(
    aggregateName: string,
    config: TypeORMAggregateStateTableConfig,
  ): this {
    this._aggregateStateTables.set(aggregateName, config);
    return this;
  }

  /**
   * Builds and returns the configured persistence infrastructure.
   *
   * @throws If {@link withEventStore} was not called.
   * @throws If {@link withSagaStore} was not called.
   */
  build(): TypeORMAdapterResult {
    if (!this._eventStoreEntity) {
      throw new Error(
        "TypeORMAdapter requires withEventStore() to be called before build()",
      );
    }
    if (!this._sagaStoreEntity) {
      throw new Error(
        "TypeORMAdapter requires withSagaStore() to be called before build()",
      );
    }

    const txStore: TypeORMTransactionStore = { current: null };

    const eventSourcedPersistence = new TypeORMEventSourcedAggregatePersistence(
      this.dataSource,
      txStore,
    );

    const stateStoredPersistence = this._stateStoreEntity
      ? new TypeORMStateStoredAggregatePersistence(this.dataSource, txStore)
      : undefined;

    const sagaPersistence = new TypeORMSagaPersistence(
      this.dataSource,
      txStore,
    );

    const snapshotStore = this._snapshotStoreEntity
      ? new TypeORMSnapshotStore(this.dataSource, txStore)
      : undefined;

    const outboxStore = this._outboxStoreEntity
      ? new TypeORMOutboxStore(this.dataSource, txStore)
      : undefined;

    const unitOfWorkFactory = createTypeORMUnitOfWorkFactory(
      this.dataSource,
      txStore,
    );

    // Build per-aggregate dedicated state persistence instances
    const dedicatedStores = new Map<string, StateStoredAggregatePersistence>();

    for (const [name, config] of this._aggregateStateTables) {
      const columns: TypeORMStateTableColumnMap = {
        ...DEFAULT_COLUMNS,
        ...config.columns,
      };

      dedicatedStores.set(
        name,
        new TypeORMDedicatedStateStoredPersistence(
          this.dataSource,
          txStore,
          config.entity,
          columns,
        ),
      );
    }

    return {
      eventSourcedPersistence,
      stateStoredPersistence,
      sagaPersistence,
      unitOfWorkFactory,
      snapshotStore,
      outboxStore,
      stateStoreFor(aggregateName: string): StateStoredAggregatePersistence {
        const store = dedicatedStores.get(aggregateName);
        if (!store) {
          throw new Error(
            `No dedicated state table configured for aggregate "${aggregateName}". ` +
              `Call .withAggregateStateTable("${aggregateName}", ...) before build().`,
          );
        }
        return store;
      },
    };
  }
}
