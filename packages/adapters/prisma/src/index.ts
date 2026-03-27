export {
  PrismaEventSourcedAggregatePersistence,
  PrismaStateStoredAggregatePersistence,
  PrismaSagaPersistence,
  PrismaSnapshotStore,
  PrismaOutboxStore,
} from "./persistence";
export { PrismaAdvisoryLocker } from "./advisory-locker";
export {
  PrismaUnitOfWork,
  createPrismaUnitOfWorkFactory,
} from "./unit-of-work";
export type { PrismaTransactionStore } from "./unit-of-work";

import type { PrismaClient } from "@prisma/client";
import type {
  UnitOfWorkFactory,
  SnapshotStore,
  OutboxStore,
} from "@noddde/core";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
} from "@noddde/core";
import {
  PrismaEventSourcedAggregatePersistence,
  PrismaStateStoredAggregatePersistence,
  PrismaSagaPersistence,
  PrismaSnapshotStore,
  PrismaOutboxStore,
} from "./persistence";
import { createPrismaUnitOfWorkFactory } from "./unit-of-work";
import type { PrismaTransactionStore } from "./unit-of-work";

/**
 * Result of {@link createPrismaPersistence}.
 */
export interface PrismaPersistenceInfrastructure {
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  stateStoredPersistence: StateStoredAggregatePersistence;
  sagaPersistence: SagaPersistence;
  snapshotStore: SnapshotStore;
  outboxStore: OutboxStore;
  unitOfWorkFactory: UnitOfWorkFactory;
}

/**
 * Creates a complete set of Prisma-backed persistence implementations.
 *
 * @param prisma - A PrismaClient instance.
 * @returns Persistence implementations and a UoW factory.
 *
 * @example
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * import { createPrismaPersistence } from "@noddde/prisma";
 * import { defineDomain, wireDomain } from "@noddde/engine";
 *
 * const prisma = new PrismaClient();
 * const infra = createPrismaPersistence(prisma);
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
export function createPrismaPersistence(
  prisma: PrismaClient,
): PrismaPersistenceInfrastructure {
  const txStore: PrismaTransactionStore = { current: null };

  return {
    eventSourcedPersistence: new PrismaEventSourcedAggregatePersistence(
      prisma,
      txStore,
    ),
    stateStoredPersistence: new PrismaStateStoredAggregatePersistence(
      prisma,
      txStore,
    ),
    sagaPersistence: new PrismaSagaPersistence(prisma, txStore),
    snapshotStore: new PrismaSnapshotStore(prisma, txStore),
    outboxStore: new PrismaOutboxStore(prisma, txStore),
    unitOfWorkFactory: createPrismaUnitOfWorkFactory(prisma, txStore),
  };
}
