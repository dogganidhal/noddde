import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { DataSource } from "typeorm";
import {
  createTypeORMAdapter,
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
  NodddeOutboxEntryEntity,
} from "@noddde/typeorm";
import {
  defineDomain,
  wireDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import type { Infrastructure } from "@noddde/core";
import { FlashSaleItem } from "./domain/write-model/aggregates/flash-sale-item";

/**
 * Flash Sale Sample -- Optimistic Concurrency with TypeORM + PostgreSQL.
 *
 * Demonstrates:
 * - Event-sourced aggregate persistence via TypeORM
 * - Optimistic concurrency control with configurable retries
 * - Concurrent command dispatching under contention
 *
 * Infrastructure features (wired when adapters are available):
 * - Snapshots: periodically snapshot aggregate state to avoid full replay
 * - Idempotency: commandId-based deduplication via IdempotencyStore
 * - Outbox: transactional outbox pattern for reliable event publishing
 */
async function main() {
  console.log(
    "Flash Sale Sample -- Optimistic Concurrency with TypeORM + PostgreSQL\n",
  );

  // Step 1: Start PostgreSQL container
  console.log("Starting PostgreSQL container...");
  const container = await new PostgreSqlContainer("postgres:16").start();
  console.log(
    `PostgreSQL running at ${container.getHost()}:${container.getMappedPort(5432)}\n`,
  );

  try {
    // Step 2: Create TypeORM DataSource (synchronize: true auto-creates tables)
    const dataSource = new DataSource({
      type: "postgres",
      url: container.getConnectionUri(),
      entities: [
        NodddeEventEntity,
        NodddeAggregateStateEntity,
        NodddeSagaStateEntity,
        NodddeSnapshotEntity,
        NodddeOutboxEntryEntity,
      ],
      synchronize: true,
    });
    await dataSource.initialize();
    console.log("Database tables created via TypeORM synchronize\n");

    // Step 3: Configure domain with optimistic concurrency
    const typeormInfra = createTypeORMAdapter(dataSource);

    // Define the domain structure (pure, sync)
    const flashSaleDomain = defineDomain<Infrastructure>({
      writeModel: { aggregates: { FlashSaleItem } },
      readModel: { projections: {} },
    });

    // Wire with infrastructure (async)
    // TODO: Wire snapshot store when available:
    //   snapshots: () => typeormInfra.snapshotStore,
    // TODO: Wire idempotency store when available:
    //   idempotency: () => typeormInfra.idempotencyStore,
    // TODO: Wire outbox when available:
    //   outbox: () => typeormInfra.outboxStore,
    const domain = await wireDomain(flashSaleDomain, {
      aggregates: {
        persistence: () => typeormInfra.eventSourcedPersistence,
        concurrency: { maxRetries: 5 },
      },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
      unitOfWork: () => typeormInfra.unitOfWorkFactory,
    });
    console.log(
      "Domain configured: optimistic concurrency with maxRetries: 5\n",
    );

    // Step 4: Create flash sale with 5 items
    await domain.dispatchCommand({
      name: "CreateFlashSale",
      targetAggregateId: "limited-edition-sneakers",
      payload: { initialStock: 5 },
    });
    console.log(
      "Flash sale created: 'limited-edition-sneakers' with 5 items in stock\n",
    );

    // Step 5: Fire 8 concurrent purchase attempts
    const buyers = [
      "alice",
      "bob",
      "charlie",
      "diana",
      "eve",
      "frank",
      "grace",
      "hank",
    ];
    console.log(`Firing ${buyers.length} concurrent purchase commands...\n`);

    const results = await Promise.allSettled(
      buyers.map((buyerId) =>
        domain.dispatchCommand({
          name: "PurchaseItem",
          targetAggregateId: "limited-edition-sneakers",
          payload: { buyerId, quantity: 1 },
        }),
      ),
    );

    // Step 6: Report results
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    console.log(
      `Results: ${fulfilled} commands completed, ${rejected} failed\n`,
    );

    // Step 7: Verify final state by loading events
    const finalEvents = await typeormInfra.eventSourcedPersistence.load(
      "FlashSaleItem",
      "limited-edition-sneakers",
    );
    const purchased = finalEvents.filter((e) => e.name === "ItemPurchased");
    const rejectedEvents = finalEvents.filter(
      (e) => e.name === "PurchaseRejected",
    );

    console.log("Final event stream:");
    for (const event of finalEvents) {
      if (event.name === "FlashSaleCreated") {
        console.log(
          `  ${event.name} -- stock: ${(event.payload as any).initialStock}`,
        );
      } else if (event.name === "ItemPurchased") {
        console.log(
          `  ${event.name} -- buyer: ${(event.payload as any).buyerId}`,
        );
      } else if (event.name === "PurchaseRejected") {
        console.log(
          `  ${event.name} -- buyer: ${(event.payload as any).buyerId} (${(event.payload as any).reason})`,
        );
      }
    }
    console.log(
      `\nSummary: ${purchased.length} purchased, ${rejectedEvents.length} rejected (out of ${buyers.length} attempts)`,
    );
    console.log(`Stock remaining: ${5 - purchased.length}`);

    await dataSource.destroy();
  } finally {
    // Step 8: Cleanup
    console.log("\nStopping PostgreSQL container...");
    await container.stop();
    console.log("Done!");
  }
}

main().catch(console.error);
