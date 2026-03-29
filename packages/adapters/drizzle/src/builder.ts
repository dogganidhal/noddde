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
 * Configuration for {@link createDrizzleAdapter}.
 *
 * `eventStore` and `sagaStore` are required. All other fields are optional
 * and their presence determines the shape of the result type.
 */
export interface DrizzleAdapterConfig {
  /** Drizzle table definition for the event store. Required. */
  eventStore: any;
  /** Drizzle table definition for the saga state store. Required. */
  sagaStore: any;
  /** Drizzle table definition for the shared aggregate state store. Optional. */
  stateStore?: any;
  /** Drizzle table definition for the snapshot store. Optional. */
  snapshotStore?: any;
  /** Drizzle table definition for the outbox store. Optional. */
  outboxStore?: any;
  /** Per-aggregate dedicated state tables with custom column mappings. Optional. */
  aggregateStates?: Record<string, AggregateStateTableConfig>;
}

/**
 * Result of {@link createDrizzleAdapter}. The type narrows based on which
 * optional stores were configured — configured stores appear as non-optional,
 * absent stores are not present on the type at all.
 *
 * @typeParam C - The adapter config, inferred from the call site.
 */
export type DrizzleAdapterResult<C extends DrizzleAdapterConfig> = {
  /** Shared event-sourced persistence (shared noddde_events table). Always present. */
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  /** Saga persistence (shared saga states table). Always present. */
  sagaPersistence: SagaPersistence;
  /** Factory for creating Drizzle-backed UnitOfWork instances. Always present. */
  unitOfWorkFactory: UnitOfWorkFactory;
} & (C extends { stateStore: any }
  ? {
      /** Shared state-stored persistence. */ stateStoredPersistence: StateStoredAggregatePersistence;
    }
  : {}) &
  (C extends { snapshotStore: any }
    ? { /** Snapshot store. */ snapshotStore: SnapshotStore }
    : {}) &
  (C extends { outboxStore: any }
    ? { /** Outbox store. */ outboxStore: OutboxStore }
    : {}) &
  (C extends { aggregateStates: Record<string, any> }
    ? {
        /**
         * Returns a {@link StateStoredAggregatePersistence} bound to a dedicated table.
         * @param name - Must be one of the aggregate names configured in `aggregateStates`.
         */
        stateStoreFor(
          name: keyof C["aggregateStates"] & string,
        ): StateStoredAggregatePersistence;
      }
    : {});

/**
 * Creates a fully-configured Drizzle persistence adapter.
 *
 * All persistence instances share the same {@link DrizzleTransactionStore},
 * ensuring UoW atomicity across shared and dedicated tables.
 *
 * The return type narrows based on the config: only configured optional stores
 * appear in the result, eliminating the need for `!` non-null assertions.
 *
 * @param db - A Drizzle database instance (any dialect).
 * @param config - Adapter configuration with table definitions and optional per-aggregate tables.
 * @returns Typed persistence infrastructure.
 *
 * @example
 * ```ts
 * import { createDrizzleAdapter } from "@noddde/drizzle";
 * import { events, sagaStates, snapshots } from "@noddde/drizzle/pg";
 * import { orders } from "./schema";
 *
 * const adapter = createDrizzleAdapter(db, {
 *   eventStore: events,
 *   sagaStore: sagaStates,
 *   snapshotStore: snapshots,
 *   aggregateStates: {
 *     Order: { table: orders },
 *   },
 * });
 *
 * adapter.snapshotStore;            // SnapshotStore (non-optional)
 * adapter.stateStoreFor("Order");   // compiles
 * adapter.stateStoreFor("Unknown"); // compile error
 * ```
 */
export function createDrizzleAdapter<const C extends DrizzleAdapterConfig>(
  db: any,
  config: C,
): DrizzleAdapterResult<C> {
  const txStore: DrizzleTransactionStore = { current: null };

  // Build the schema object for shared persistence classes
  const schema: any = {
    events: config.eventStore,
    aggregateStates: config.stateStore,
    sagaStates: config.sagaStore,
    snapshots: config.snapshotStore,
    outbox: config.outboxStore,
  };

  const result: Record<string, any> = {
    eventSourcedPersistence: new DrizzleEventSourcedAggregatePersistence(
      db,
      txStore,
      schema,
    ),
    sagaPersistence: new DrizzleSagaPersistence(db, txStore, schema),
    unitOfWorkFactory: createDrizzleUnitOfWorkFactory(db, txStore),
  };

  if (config.stateStore) {
    result.stateStoredPersistence = new DrizzleStateStoredAggregatePersistence(
      db,
      txStore,
      schema,
    );
  }

  if (config.snapshotStore) {
    result.snapshotStore = new DrizzleSnapshotStore(db, txStore, schema);
  }

  if (config.outboxStore) {
    result.outboxStore = new DrizzleOutboxStore(db, txStore, schema);
  }

  if (config.aggregateStates) {
    const dedicatedStores = new Map<string, StateStoredAggregatePersistence>();

    for (const [name, aggConfig] of Object.entries(config.aggregateStates)) {
      const columns = resolveColumns(aggConfig.table, name, aggConfig.columns);
      dedicatedStores.set(
        name,
        new DrizzleDedicatedStateStoredPersistence(
          db,
          txStore,
          aggConfig.table,
          columns,
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

  return result as any as DrizzleAdapterResult<C>;
}
