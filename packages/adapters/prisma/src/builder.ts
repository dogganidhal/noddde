/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  SnapshotStore,
  OutboxStore,
  UnitOfWorkFactory,
} from "@noddde/core";
import type { PrismaTransactionStore } from "./unit-of-work";
import {
  PrismaEventSourcedAggregatePersistence,
  PrismaStateStoredAggregatePersistence,
  PrismaSagaPersistence,
  PrismaSnapshotStore,
  PrismaOutboxStore,
} from "./persistence";
import { PrismaDedicatedStateStoredPersistence } from "./dedicated-state-persistence";
import { createPrismaUnitOfWorkFactory } from "./unit-of-work";

/**
 * Column mapping for a custom state-stored aggregate table in Prisma.
 * Maps logical noddde columns to Prisma model property names.
 * Defaults: `{ aggregateId: "aggregateId", state: "state", version: "version" }`.
 */
export interface PrismaStateTableColumnMap {
  /** Property name holding the aggregate instance ID (string PK). */
  aggregateId: string;
  /** Property name holding the serialized aggregate state (text). */
  state: string;
  /** Property name holding the version number (integer). */
  version: string;
}

/**
 * Configuration for a per-aggregate state table in Prisma.
 */
export interface PrismaAggregateStateTableConfig {
  /** Prisma model name (camelCase as used in PrismaClient, e.g., "order"). */
  model: string;
  /** Column mappings. If omitted, uses defaults: aggregateId, state, version. */
  columns?: Partial<PrismaStateTableColumnMap>;
}

/**
 * Result of {@link PrismaAdapter.build}. Provides all persistence
 * implementations, a UoW factory, and per-aggregate state store access.
 */
export interface PrismaAdapterResult {
  /** Shared event-sourced persistence (noddde_events table). */
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  /**
   * Shared state-stored persistence (noddde_aggregate_states table).
   * Undefined if {@link PrismaAdapter.withStateStore} was not called.
   */
  stateStoredPersistence?: StateStoredAggregatePersistence;
  /** Saga persistence (always shared table). */
  sagaPersistence: SagaPersistence;
  /** Factory for creating Prisma-backed UnitOfWork instances. */
  unitOfWorkFactory: UnitOfWorkFactory;
  /** Snapshot store. Present only when {@link PrismaAdapter.withSnapshotStore} was called. */
  snapshotStore?: SnapshotStore;
  /** Outbox store. Present only when {@link PrismaAdapter.withOutboxStore} was called. */
  outboxStore?: OutboxStore;
  /**
   * Returns a {@link StateStoredAggregatePersistence} bound to a specific
   * aggregate's dedicated Prisma model. Throws if no such aggregate was
   * configured via {@link PrismaAdapter.withAggregateStateTable}.
   *
   * @param aggregateName - The aggregate name as registered with `withAggregateStateTable`.
   * @throws If the aggregate was not configured.
   */
  stateStoreFor(aggregateName: string): StateStoredAggregatePersistence;
}

const DEFAULT_COLUMNS: PrismaStateTableColumnMap = {
  aggregateId: "aggregateId",
  state: "state",
  version: "version",
};

/**
 * Builder for constructing a fully-configured Prisma persistence layer.
 * Supports shared tables (existing behavior) plus per-aggregate
 * dedicated state tables with custom column mappings.
 *
 * All persistence instances created by a single builder share the same
 * {@link PrismaTransactionStore}, ensuring UoW atomicity.
 *
 * @example
 * ```ts
 * import { PrismaAdapter } from "@noddde/prisma";
 * import { PrismaClient } from "@prisma/client";
 *
 * const prisma = new PrismaClient();
 *
 * const adapter = new PrismaAdapter(prisma)
 *   .withEventStore()
 *   .withSagaStore()
 *   .withSnapshotStore()
 *   .withAggregateStateTable("Order", { model: "order" })
 *   .build();
 *
 * const orderPersistence = adapter.stateStoreFor("Order");
 * ```
 */
export class PrismaAdapter {
  private _eventStore = false;
  private _stateStore = false;
  private _sagaStore = false;
  private _snapshotStore = false;
  private _outboxStore = false;
  private _aggregateStateTables = new Map<
    string,
    PrismaAggregateStateTableConfig
  >();

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Configures the shared event store (NodddeEvent model).
   * Required for {@link build}.
   */
  withEventStore(): this {
    this._eventStore = true;
    return this;
  }

  /**
   * Configures the shared aggregate state store (NodddeAggregateState model).
   * Optional — only needed if some aggregates use the shared table.
   */
  withStateStore(): this {
    this._stateStore = true;
    return this;
  }

  /**
   * Configures the saga state store (NodddeSagaState model).
   * Required for {@link build}.
   */
  withSagaStore(): this {
    this._sagaStore = true;
    return this;
  }

  /**
   * Configures the snapshot store (NodddeSnapshot model).
   * Optional.
   */
  withSnapshotStore(): this {
    this._snapshotStore = true;
    return this;
  }

  /**
   * Configures the outbox store (NodddeOutboxEntry model).
   * Optional.
   */
  withOutboxStore(): this {
    this._outboxStore = true;
    return this;
  }

  /**
   * Maps an aggregate to a dedicated state table. The persistence
   * instance returned by {@link PrismaAdapterResult.stateStoreFor}
   * will query/write this specific Prisma model instead of the shared
   * `noddde_aggregate_states`.
   *
   * @param aggregateName - The aggregate name (must match the name used in domain definition).
   * @param config - Prisma model name and optional column mappings.
   */
  withAggregateStateTable(
    aggregateName: string,
    config: PrismaAggregateStateTableConfig,
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
  build(): PrismaAdapterResult {
    if (!this._eventStore) {
      throw new Error(
        "PrismaAdapter requires withEventStore() to be called before build()",
      );
    }
    if (!this._sagaStore) {
      throw new Error(
        "PrismaAdapter requires withSagaStore() to be called before build()",
      );
    }

    const txStore: PrismaTransactionStore = { current: null };

    const eventSourcedPersistence = new PrismaEventSourcedAggregatePersistence(
      this.prisma,
      txStore,
    );

    const stateStoredPersistence = this._stateStore
      ? new PrismaStateStoredAggregatePersistence(this.prisma, txStore)
      : undefined;

    const sagaPersistence = new PrismaSagaPersistence(this.prisma, txStore);

    const snapshotStore = this._snapshotStore
      ? new PrismaSnapshotStore(this.prisma, txStore)
      : undefined;

    const outboxStore = this._outboxStore
      ? new PrismaOutboxStore(this.prisma, txStore)
      : undefined;

    const unitOfWorkFactory = createPrismaUnitOfWorkFactory(
      this.prisma,
      txStore,
    );

    // Build per-aggregate dedicated state persistence instances
    const dedicatedStores = new Map<string, StateStoredAggregatePersistence>();

    for (const [name, config] of this._aggregateStateTables) {
      const columns: PrismaStateTableColumnMap = {
        ...DEFAULT_COLUMNS,
        ...config.columns,
      };

      // Validate the model delegate exists on the Prisma client
      const delegate = (this.prisma as any)[config.model];
      if (!delegate) {
        throw new Error(
          `Prisma model "${config.model}" not found on PrismaClient for aggregate "${name}". ` +
            `Ensure the model is defined in your Prisma schema and prisma generate has been run.`,
        );
      }

      dedicatedStores.set(
        name,
        new PrismaDedicatedStateStoredPersistence(
          this.prisma,
          txStore,
          config.model,
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
