/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
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
import type { PrismaTransactionStore } from "./unit-of-work";
import type { PrismaStateTableColumnMap } from "./builder";
import {
  PrismaEventSourcedAggregatePersistence,
  PrismaStateStoredAggregatePersistence,
  PrismaSagaPersistence,
  PrismaSnapshotStore,
  PrismaOutboxStore,
} from "./persistence";
import { PrismaDedicatedStateStoredPersistence } from "./dedicated-state-persistence";
import { createPrismaUnitOfWorkFactory } from "./unit-of-work";
import { PrismaAdvisoryLocker } from "./advisory-locker";
import type { PrismaDialect } from "./advisory-locker";

const DEFAULT_COLUMNS: PrismaStateTableColumnMap = {
  aggregateId: "aggregateId",
  state: "state",
  version: "version",
};

/**
 * Prisma-backed persistence adapter implementing {@link PersistenceAdapter}.
 *
 * Uses built-in Prisma models (NodddeEvent, NodddeAggregateState, etc.)
 * for all stores. No configuration needed beyond the PrismaClient instance.
 *
 * Advisory locking requires the `dialect` option since PrismaClient does
 * not expose the database provider at runtime.
 *
 * @example
 * ```ts
 * import { PrismaAdapter } from "@noddde/prisma";
 * import { wireDomain } from "@noddde/engine";
 *
 * const adapter = new PrismaAdapter(prisma);
 * const domain = await wireDomain(definition, { persistenceAdapter: adapter });
 * ```
 */
export class PrismaAdapter implements PersistenceAdapter {
  readonly unitOfWorkFactory: UnitOfWorkFactory;
  readonly eventSourcedPersistence: EventSourcedAggregatePersistence;
  readonly stateStoredPersistence: StateStoredAggregatePersistence;
  readonly sagaPersistence: SagaPersistence;
  readonly snapshotStore: SnapshotStore;
  readonly outboxStore: OutboxStore;
  readonly aggregateLocker?: AggregateLocker;

  private readonly prisma: PrismaClient;
  private readonly txStore: PrismaTransactionStore;

  constructor(prisma: PrismaClient, options?: { dialect?: PrismaDialect }) {
    this.prisma = prisma;
    this.txStore = { current: null };

    this.eventSourcedPersistence = new PrismaEventSourcedAggregatePersistence(
      prisma,
      this.txStore,
    );
    this.stateStoredPersistence = new PrismaStateStoredAggregatePersistence(
      prisma,
      this.txStore,
    );
    this.sagaPersistence = new PrismaSagaPersistence(prisma, this.txStore);
    this.snapshotStore = new PrismaSnapshotStore(prisma, this.txStore);
    this.outboxStore = new PrismaOutboxStore(prisma, this.txStore);
    this.unitOfWorkFactory = createPrismaUnitOfWorkFactory(
      prisma,
      this.txStore,
    );

    // Advisory locker requires explicit dialect
    if (options?.dialect) {
      this.aggregateLocker = new PrismaAdvisoryLocker(prisma, options.dialect);
    }
  }

  /**
   * Returns a {@link StateStoredAggregatePersistence} bound to a dedicated
   * Prisma model. Use this when an aggregate needs its own state table
   * instead of the shared one.
   *
   * @param model - The Prisma model name (camelCase, e.g., "order").
   * @param columns - Optional column mapping overrides.
   * @returns A persistence implementation bound to the given model.
   */
  stateStored(
    model: string,
    columns?: Partial<PrismaStateTableColumnMap>,
  ): StateStoredAggregatePersistence {
    const resolvedColumns: PrismaStateTableColumnMap = {
      ...DEFAULT_COLUMNS,
      ...columns,
    };

    // Validate the model delegate exists on the Prisma client
    const delegate = (this.prisma as any)[model];
    if (!delegate) {
      throw new Error(
        `Prisma model "${model}" not found on PrismaClient. ` +
          `Ensure the model is defined in your Prisma schema and prisma generate has been run.`,
      );
    }

    return new PrismaDedicatedStateStoredPersistence(
      this.prisma,
      this.txStore,
      model,
      resolvedColumns,
    );
  }

  /**
   * Calls `prisma.$disconnect()` to close the connection pool.
   */
  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
