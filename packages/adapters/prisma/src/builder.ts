/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  SnapshotStore,
  OutboxStore,
  UnitOfWorkFactory,
  AggregateStateMapper,
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
 * Prisma-specific bi-directional mapper between an aggregate's state and
 * the state portion of a row on a Prisma model. Extends the core
 * {@link AggregateStateMapper} with the Prisma model property names the
 * adapter needs at query-construction time.
 *
 * The mapper's `toRow` / `fromRow` handle only the state portion of the row.
 * The adapter writes the aggregate id and version itself using the property
 * names provided by `aggregateIdField` and `versionField`.
 *
 * @typeParam TState - The aggregate's state type.
 * @typeParam TRow   - The Prisma row shape (e.g. `Prisma.<Model>UncheckedCreateInput`).
 */
export interface PrismaStateMapper<TState, TRow extends Record<string, unknown>>
  extends AggregateStateMapper<TState, Partial<TRow>> {
  /** The name of the Prisma model property holding the aggregate instance ID. */
  readonly aggregateIdField: keyof TRow & string;
  /** The name of the Prisma model property holding the version number. */
  readonly versionField: keyof TRow & string;
}

/**
 * Configuration for a per-aggregate state table in Prisma. The `mapper` is
 * required and is the single source of truth for the row schema.
 *
 * @typeParam TState - The aggregate's state type.
 * @typeParam TRow   - The Prisma row shape.
 */
export interface PrismaAggregateStateTableConfig<
  TState = unknown,
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Prisma model name (camelCase as used in PrismaClient, e.g., "order"). */
  model: string;
  /** The bi-directional state mapper for this aggregate's model. Required. */
  mapper: PrismaStateMapper<TState, TRow>;
}

/**
 * Configuration for {@link createPrismaAdapter}.
 *
 * Event store, state store, and saga store are always created (built-in Prisma models).
 * Optional stores (snapshot, outbox) and per-aggregate tables are configured here.
 */
export interface PrismaAdapterConfig {
  /** Enable the snapshot store (NodddeSnapshot model). Optional. */
  snapshotStore?: true;
  /** Enable the outbox store (NodddeOutboxEntry model). Optional. */
  outboxStore?: true;
  /** Per-aggregate dedicated state tables with custom column mappings. Optional. */
  aggregateStates?: Record<string, PrismaAggregateStateTableConfig>;
}

/**
 * Result of {@link createPrismaAdapter}. The type narrows based on which
 * optional stores were configured — configured stores appear as non-optional.
 *
 * Event store, state store, saga store, and UoW are always present.
 *
 * @typeParam C - The adapter config, inferred from the call site.
 */
export type PrismaAdapterResult<C extends PrismaAdapterConfig> = {
  /** Shared event-sourced persistence (noddde_events). Always present. */
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  /** Shared state-stored persistence (noddde_aggregate_states). Always present. */
  stateStoredPersistence: StateStoredAggregatePersistence;
  /** Saga persistence (noddde_saga_states). Always present. */
  sagaPersistence: SagaPersistence;
  /** Factory for creating Prisma-backed UnitOfWork instances. Always present. */
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
         * Returns a {@link StateStoredAggregatePersistence} bound to a dedicated Prisma model.
         * @param name - Must be one of the aggregate names configured in `aggregateStates`.
         */
        stateStoreFor(
          name: keyof C["aggregateStates"] & string,
        ): StateStoredAggregatePersistence;
      }
    : {});

/**
 * Creates a fully-configured Prisma persistence adapter.
 *
 * Event store, state store, saga store, and UoW are always created (built-in
 * Prisma models). The config controls optional stores and per-aggregate tables.
 *
 * The return type narrows based on the config: only configured optional stores
 * appear in the result, eliminating the need for `!` non-null assertions.
 *
 * @param prisma - A PrismaClient instance.
 * @param config - Optional adapter configuration for snapshots, outbox, and per-aggregate tables.
 * @returns Typed persistence infrastructure.
 *
 * @example
 * ```ts
 * import { createPrismaAdapter } from "@noddde/prisma";
 *
 * // Minimal — just event store, state store, saga store, UoW
 * const adapter = createPrismaAdapter(prisma);
 *
 * // With snapshots and per-aggregate tables
 * const adapter = createPrismaAdapter(prisma, {
 *   snapshotStore: true,
 *   aggregateStates: {
 *     Order: { model: "order" },
 *   },
 * });
 *
 * adapter.snapshotStore;            // SnapshotStore (non-optional)
 * adapter.stateStoreFor("Order");   // compiles
 * adapter.stateStoreFor("Unknown"); // compile error
 * ```
 */
// eslint-disable-next-line no-redeclare
export function createPrismaAdapter(
  prisma: PrismaClient,
): PrismaAdapterResult<{}>;
// eslint-disable-next-line no-redeclare
export function createPrismaAdapter<const C extends PrismaAdapterConfig>(
  prisma: PrismaClient,
  config: C,
): PrismaAdapterResult<C>;
// eslint-disable-next-line no-redeclare
export function createPrismaAdapter(
  prisma: PrismaClient,
  config?: PrismaAdapterConfig,
): any {
  const txStore: PrismaTransactionStore = { current: null };

  const result: Record<string, any> = {
    eventSourcedPersistence: new PrismaEventSourcedAggregatePersistence(
      prisma,
      txStore,
    ),
    stateStoredPersistence: new PrismaStateStoredAggregatePersistence(
      prisma,
      txStore,
    ),
    sagaPersistence: new PrismaSagaPersistence(prisma, txStore),
    unitOfWorkFactory: createPrismaUnitOfWorkFactory(prisma, txStore),
  };

  if (config?.snapshotStore) {
    result.snapshotStore = new PrismaSnapshotStore(prisma, txStore);
  }

  if (config?.outboxStore) {
    result.outboxStore = new PrismaOutboxStore(prisma, txStore);
  }

  if (config?.aggregateStates) {
    const dedicatedStores = new Map<string, StateStoredAggregatePersistence>();

    for (const [name, aggConfig] of Object.entries(config.aggregateStates)) {
      // Validate the model delegate exists on the Prisma client
      const delegate = (prisma as any)[aggConfig.model];
      if (!delegate) {
        throw new Error(
          `Prisma model "${aggConfig.model}" not found on PrismaClient for aggregate "${name}". ` +
            `Ensure the model is defined in your Prisma schema and prisma generate has been run.`,
        );
      }

      dedicatedStores.set(
        name,
        new PrismaDedicatedStateStoredPersistence(
          prisma,
          txStore,
          aggConfig.model,
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
