/**
 * Flash Sale Sample -- Pessimistic Concurrency with Prisma + MySQL.
 *
 * Demonstrates the pessimistic locking pattern where aggregate state is
 * loaded with a SELECT ... FOR UPDATE, preventing concurrent modifications.
 * This eliminates retry loops at the cost of brief lock contention.
 *
 * NOTE: This is a reference entry point. A @noddde/prisma adapter is
 * required to run this sample end-to-end. The structure shows the wiring
 * pattern for pessimistic concurrency.
 */

import {
  defineDomain,
  // wireDomain,
  // EventEmitterEventBus,
  // InMemoryCommandBus,
  // InMemoryQueryBus,
} from "@noddde/engine";
import type { Infrastructure } from "@noddde/core";
import { FlashSaleItem } from "./domain/write-model/aggregates/flash-sale-item";

async function main() {
  console.log(
    "Flash Sale Sample -- Pessimistic Concurrency with Prisma + MySQL\n",
  );

  // TODO: Start MySQL container via testcontainers
  // const container = await new MySqlContainer("mysql:8").start();

  // TODO: Initialize Prisma client
  // const prisma = new PrismaClient({
  //   datasources: { db: { url: container.getConnectionUri() } },
  // });
  // await prisma.$executeRawUnsafe(`
  //   CREATE TABLE noddde_events ( ... );
  //   CREATE TABLE noddde_aggregate_states ( ... );
  //   CREATE TABLE noddde_saga_states ( ... );
  // `);

  // Define the domain structure (pure, sync -- same as optimistic)
  void defineDomain<Infrastructure>({
    writeModel: { aggregates: { FlashSaleItem } },
    readModel: { projections: {} },
  });

  // TODO: Wire with Prisma persistence and pessimistic concurrency
  // const prismaPersistence = createPrismaPersistence(prisma);
  //
  // const domain = await wireDomain(flashSaleDomain, {
  //   aggregates: {
  //     persistence: () => prismaPersistence.eventSourcedPersistence,
  //     concurrency: { strategy: "pessimistic" },
  //   },
  //   buses: () => ({
  //     commandBus: new InMemoryCommandBus(),
  //     eventBus: new EventEmitterEventBus(),
  //     queryBus: new InMemoryQueryBus(),
  //   }),
  //   unitOfWork: () => prismaPersistence.unitOfWorkFactory,
  // });

  // TODO: Run the same flash sale scenario as main-optimistic.ts
  // The key difference is that concurrent PurchaseItem commands will
  // serialize through MySQL row-level locks instead of retrying on
  // optimistic concurrency conflicts.
  //
  // await domain.dispatchCommand({
  //   name: "CreateFlashSale",
  //   targetAggregateId: "limited-edition-sneakers",
  //   payload: { initialStock: 5 },
  // });
  //
  // const buyers = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "hank"];
  // await Promise.allSettled(
  //   buyers.map((buyerId) =>
  //     domain.dispatchCommand({
  //       name: "PurchaseItem",
  //       targetAggregateId: "limited-edition-sneakers",
  //       payload: { buyerId, quantity: 1 },
  //     }),
  //   ),
  // );

  console.log(
    "Pessimistic concurrency entry point is a placeholder.\n" +
      "Requires @noddde/prisma adapter to run end-to-end.\n" +
      "See main-optimistic.ts for a working example with Drizzle + PostgreSQL.",
  );

  // TODO: Cleanup
  // await prisma.$disconnect();
  // await container.stop();
}

main().catch(console.error);
