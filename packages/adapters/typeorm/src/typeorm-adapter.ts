/* eslint-disable no-unused-vars */
import type { DataSource } from "typeorm";
import type {
  PersistenceAdapter,
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  UnitOfWorkFactory,
  SnapshotStore,
  OutboxStore,
  AggregateLocker,
} from "@noddde/core";
import type { TypeORMTransactionStore } from "./unit-of-work";
import type { TypeORMStateTableColumnMap } from "./builder";
import {
  TypeORMEventSourcedAggregatePersistence,
  TypeORMStateStoredAggregatePersistence,
  TypeORMSagaPersistence,
  TypeORMSnapshotStore,
  TypeORMOutboxStore,
} from "./persistence";
import { TypeORMDedicatedStateStoredPersistence } from "./dedicated-state-persistence";
import { createTypeORMUnitOfWorkFactory } from "./unit-of-work";
import { TypeORMAdvisoryLocker } from "./advisory-locker";

const DEFAULT_COLUMNS: TypeORMStateTableColumnMap = {
  aggregateId: "aggregateId",
  state: "state",
  version: "version",
};

/** Database types that support advisory locking. */
const ADVISORY_LOCK_TYPES = new Set(["postgres", "mysql", "mariadb", "mssql"]);

/**
 * TypeORM-backed persistence adapter implementing {@link PersistenceAdapter}.
 *
 * Uses built-in entity classes (NodddeEventEntity, NodddeAggregateStateEntity, etc.)
 * for all stores. No configuration needed beyond the DataSource instance.
 * Advisory locker is auto-detected from `dataSource.options.type`.
 *
 * @example
 * ```ts
 * import { TypeORMAdapter } from "@noddde/typeorm";
 * import { wireDomain } from "@noddde/engine";
 *
 * const adapter = new TypeORMAdapter(dataSource);
 * const domain = await wireDomain(definition, { persistenceAdapter: adapter });
 * ```
 */
export class TypeORMAdapter implements PersistenceAdapter {
  readonly unitOfWorkFactory: UnitOfWorkFactory;
  readonly eventSourcedPersistence: EventSourcedAggregatePersistence;
  readonly stateStoredPersistence: StateStoredAggregatePersistence;
  readonly sagaPersistence: SagaPersistence;
  readonly snapshotStore: SnapshotStore;
  readonly outboxStore: OutboxStore;
  readonly aggregateLocker?: AggregateLocker;

  private readonly dataSource: DataSource;
  private readonly txStore: TypeORMTransactionStore;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.txStore = { current: null };

    this.eventSourcedPersistence = new TypeORMEventSourcedAggregatePersistence(
      dataSource,
      this.txStore,
    );
    this.stateStoredPersistence = new TypeORMStateStoredAggregatePersistence(
      dataSource,
      this.txStore,
    );
    this.sagaPersistence = new TypeORMSagaPersistence(dataSource, this.txStore);
    this.snapshotStore = new TypeORMSnapshotStore(dataSource, this.txStore);
    this.outboxStore = new TypeORMOutboxStore(dataSource, this.txStore);
    this.unitOfWorkFactory = createTypeORMUnitOfWorkFactory(
      dataSource,
      this.txStore,
    );

    // Advisory locker auto-detected from dataSource.options.type
    const dbType = dataSource.options.type;
    if (ADVISORY_LOCK_TYPES.has(dbType)) {
      this.aggregateLocker = new TypeORMAdvisoryLocker(dataSource);
    }
  }

  /**
   * Returns a {@link StateStoredAggregatePersistence} bound to a dedicated
   * TypeORM entity. Use this when an aggregate needs its own state table
   * instead of the shared one.
   *
   * @param entity - A TypeORM entity class.
   * @param columns - Optional column mapping overrides.
   * @returns A persistence implementation bound to the given entity.
   */
  stateStored(
    entity: Function,
    columns?: Partial<TypeORMStateTableColumnMap>,
  ): StateStoredAggregatePersistence {
    const resolvedColumns: TypeORMStateTableColumnMap = {
      ...DEFAULT_COLUMNS,
      ...columns,
    };
    return new TypeORMDedicatedStateStoredPersistence(
      this.dataSource,
      this.txStore,
      entity,
      resolvedColumns,
    );
  }

  /**
   * Calls `dataSource.destroy()` to close the connection pool.
   */
  async close(): Promise<void> {
    await this.dataSource.destroy();
  }
}
