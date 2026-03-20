export {
  PrismaEventSourcedAggregatePersistence,
  PrismaStateStoredAggregatePersistence,
  PrismaSagaPersistence,
} from "./persistence";
export { PrismaAdvisoryLocker } from "./advisory-locker";
export {
  PrismaUnitOfWork,
  createPrismaUnitOfWorkFactory,
} from "./unit-of-work";
export type { PrismaTransactionStore } from "./unit-of-work";

import type { PrismaClient } from "@prisma/client";
import type { UnitOfWorkFactory } from "@noddde/core";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
} from "@noddde/core";
import {
  PrismaEventSourcedAggregatePersistence,
  PrismaStateStoredAggregatePersistence,
  PrismaSagaPersistence,
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
 *
 * const prisma = new PrismaClient();
 * const infra = createPrismaPersistence(prisma);
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
    unitOfWorkFactory: createPrismaUnitOfWorkFactory(prisma, txStore),
  };
}
