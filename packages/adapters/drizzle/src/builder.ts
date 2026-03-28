/* eslint-disable no-unused-vars */
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  SnapshotStore,
  OutboxStore,
  UnitOfWorkFactory,
} from "@noddde/core";
import type { DrizzleTransactionStore } from "./index";
import {
  DrizzleEventSourcedAggregatePersistence,
  DrizzleStateStoredAggregatePersistence,
  DrizzleSagaPersistence,
  DrizzleSnapshotStore,
  DrizzleOutboxStore,
} from "./persistence";
import { DrizzleDedicatedStateStoredPersistence } from "./dedicated-state-persistence";
import { createDrizzleUnitOfWorkFactory } from "./unit-of-work";
import { resolveColumns } from "./column-resolver";

/**
 * Column mapping for a custom state-stored aggregate table.
 * Maps logical noddde columns to actual Drizzle column references.
 * If omitted from {@link AggregateStateTableConfig}, columns are
 * resolved by convention (looks for columns named `aggregate_id`,
 * `state`, `version`).
 */
export interface StateTableColumnMap {
  /** Column holding the aggregate instance ID (string PK). */
  aggregateId: any;
  /** Column holding the serialized aggregate state (text/jsonb). */
  state: any;
  /** Column holding the version number (integer). */
  version: any;
}

/**
 * Configuration for a per-aggregate state table.
 */
export interface AggregateStateTableConfig {
  /** The Drizzle table definition. */
  table: any;
  /** Column mappings. If omitted, uses convention-based defaults. */
  columns?: Partial<StateTableColumnMap>;
}

/**
 * Result of {@link DrizzleAdapter.build}. Provides all persistence
 * implementations, a UoW factory, and per-aggregate state store access.
 */
export interface DrizzleAdapterResult {
  /** Shared event-sourced persistence (shared noddde_events table). */
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  /**
   * Shared state-stored persistence (shared noddde_aggregate_states table).
   * Undefined if {@link DrizzleAdapter.withStateStore} was not called.
   */
  stateStoredPersistence?: StateStoredAggregatePersistence;
  /** Saga persistence (always shared table). */
  sagaPersistence: SagaPersistence;
  /** Factory for creating Drizzle-backed UnitOfWork instances. */
  unitOfWorkFactory: UnitOfWorkFactory;
  /** Snapshot store. Present only when {@link DrizzleAdapter.withSnapshotStore} was called. */
  snapshotStore?: SnapshotStore;
  /** Outbox store. Present only when {@link DrizzleAdapter.withOutboxStore} was called. */
  outboxStore?: OutboxStore;
  /**
   * Returns a {@link StateStoredAggregatePersistence} bound to a specific
   * aggregate's dedicated table. Throws if no such aggregate was configured
   * via {@link DrizzleAdapter.withAggregateStateTable}.
   *
   * @param aggregateName - The aggregate name as registered with `withAggregateStateTable`.
   * @throws If the aggregate was not configured.
   */
  stateStoreFor(aggregateName: string): StateStoredAggregatePersistence;
}

/**
 * Builder for constructing a fully-configured Drizzle persistence layer.
 * Supports shared tables (existing behavior) plus per-aggregate
 * dedicated state tables with custom column mappings.
 *
 * All persistence instances created by a single builder share the same
 * {@link DrizzleTransactionStore}, ensuring UoW atomicity.
 *
 * @example
 * ```ts
 * import { DrizzleAdapter } from "@noddde/drizzle";
 * import { events, sagaStates } from "@noddde/drizzle/pg";
 * import { orders } from "./schema";
 *
 * const adapter = new DrizzleAdapter(db)
 *   .withEventStore(events)
 *   .withSagaStore(sagaStates)
 *   .withAggregateStateTable("Order", { table: orders })
 *   .build();
 *
 * const orderPersistence = adapter.stateStoreFor("Order");
 * ```
 */
export class DrizzleAdapter {
  private _eventStore: any | undefined;
  private _stateStore: any | undefined;
  private _sagaStore: any | undefined;
  private _snapshotStore: any | undefined;
  private _outboxStore: any | undefined;
  private _aggregateStateTables = new Map<string, AggregateStateTableConfig>();

  constructor(private readonly db: any) {}

  /**
   * Configures the shared event store table (e.g., `noddde_events`).
   * Required for {@link build}.
   */
  withEventStore(table: any): this {
    this._eventStore = table;
    return this;
  }

  /**
   * Configures the shared aggregate state table (e.g., `noddde_aggregate_states`).
   * Optional — only needed if some aggregates use the shared table.
   */
  withStateStore(table: any): this {
    this._stateStore = table;
    return this;
  }

  /**
   * Configures the saga state table (e.g., `noddde_saga_states`).
   * Required for {@link build}.
   */
  withSagaStore(table: any): this {
    this._sagaStore = table;
    return this;
  }

  /**
   * Configures the snapshot table (e.g., `noddde_snapshots`).
   * Optional.
   */
  withSnapshotStore(table: any): this {
    this._snapshotStore = table;
    return this;
  }

  /**
   * Configures the outbox table (e.g., `noddde_outbox`).
   * Optional.
   */
  withOutboxStore(table: any): this {
    this._outboxStore = table;
    return this;
  }

  /**
   * Maps an aggregate to a dedicated state table. The persistence
   * instance returned by {@link DrizzleAdapterResult.stateStoreFor}
   * will query/write this specific table instead of the shared
   * `noddde_aggregate_states`.
   *
   * @param aggregateName - The aggregate name (must match the name used in domain definition).
   * @param config - Table definition and optional column mappings.
   */
  withAggregateStateTable(
    aggregateName: string,
    config: AggregateStateTableConfig,
  ): this {
    this._aggregateStateTables.set(aggregateName, config);
    return this;
  }

  /**
   * Builds and returns the configured persistence infrastructure.
   *
   * @throws If {@link withEventStore} was not called.
   * @throws If {@link withSagaStore} was not called.
   * @throws If convention-based column resolution fails for any aggregate state table.
   */
  build(): DrizzleAdapterResult {
    if (!this._eventStore) {
      throw new Error(
        "DrizzleAdapter requires withEventStore() to be called before build()",
      );
    }
    if (!this._sagaStore) {
      throw new Error(
        "DrizzleAdapter requires withSagaStore() to be called before build()",
      );
    }

    const txStore: DrizzleTransactionStore = { current: null };

    // Build the schema object for shared persistence classes
    const schema: any = {
      events: this._eventStore,
      aggregateStates: this._stateStore,
      sagaStates: this._sagaStore,
      snapshots: this._snapshotStore,
      outbox: this._outboxStore,
    };

    // Shared persistence instances
    const eventSourcedPersistence = new DrizzleEventSourcedAggregatePersistence(
      this.db,
      txStore,
      schema,
    );

    const stateStoredPersistence = this._stateStore
      ? new DrizzleStateStoredAggregatePersistence(this.db, txStore, schema)
      : undefined;

    const sagaPersistence = new DrizzleSagaPersistence(
      this.db,
      txStore,
      schema,
    );

    const snapshotStore = this._snapshotStore
      ? new DrizzleSnapshotStore(this.db, txStore, schema)
      : undefined;

    const outboxStore = this._outboxStore
      ? new DrizzleOutboxStore(this.db, txStore, schema)
      : undefined;

    const unitOfWorkFactory = createDrizzleUnitOfWorkFactory(this.db, txStore);

    // Build per-aggregate dedicated state persistence instances
    const dedicatedStores = new Map<string, StateStoredAggregatePersistence>();

    for (const [name, config] of this._aggregateStateTables) {
      const columns = resolveColumns(config.table, name, config.columns);
      dedicatedStores.set(
        name,
        new DrizzleDedicatedStateStoredPersistence(
          this.db,
          txStore,
          config.table,
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
