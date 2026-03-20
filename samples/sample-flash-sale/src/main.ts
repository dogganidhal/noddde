import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createDrizzlePersistence } from "@noddde/drizzle";
import { events, aggregateStates, sagaStates } from "@noddde/drizzle/pg";
import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import type { Infrastructure } from "@noddde/core";
import { FlashSaleItem } from "./aggregate";

async function main() {
  console.log(
    "Flash Sale Sample — Optimistic Concurrency with Drizzle + PostgreSQL\n",
  );

  // Step 1: Start PostgreSQL container
  console.log("Starting PostgreSQL container...");
  const container = await new PostgreSqlContainer("postgres:16").start();
  console.log(
    `PostgreSQL running at ${container.getHost()}:${container.getMappedPort(5432)}\n`,
  );

  try {
    // Step 2: Create tables
    const pool = new pg.Pool({
      connectionString: container.getConnectionUri(),
    });
    await pool.query(`
      CREATE TABLE noddde_events (
        id SERIAL PRIMARY KEY,
        aggregate_name TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        event_name TEXT NOT NULL,
        payload JSONB NOT NULL,
        UNIQUE (aggregate_name, aggregate_id, sequence_number)
      );
      CREATE TABLE noddde_aggregate_states (
        aggregate_name TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        state JSONB NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (aggregate_name, aggregate_id)
      );
      CREATE TABLE noddde_saga_states (
        saga_name TEXT NOT NULL,
        saga_id TEXT NOT NULL,
        state JSONB NOT NULL,
        PRIMARY KEY (saga_name, saga_id)
      );
    `);
    console.log("Database tables created (with unique constraint on events)\n");

    // Step 3: Configure domain with optimistic concurrency
    const db = drizzle(pool);
    const drizzleInfra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });

    const domain = await configureDomain<Infrastructure>({
      writeModel: { aggregates: { FlashSaleItem } },
      readModel: { projections: {} },
      infrastructure: {
        aggregatePersistence: () => drizzleInfra.eventSourcedPersistence,
        unitOfWorkFactory: () => drizzleInfra.unitOfWorkFactory,
        aggregateConcurrency: { maxRetries: 5 },
        cqrsInfrastructure: () => ({
          commandBus: new InMemoryCommandBus(),
          eventBus: new EventEmitterEventBus(),
          queryBus: new InMemoryQueryBus(),
        }),
      },
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
    const finalEvents = await drizzleInfra.eventSourcedPersistence.load(
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
          `  ${event.name} — stock: ${(event.payload as any).initialStock}`,
        );
      } else if (event.name === "ItemPurchased") {
        console.log(
          `  ${event.name} — buyer: ${(event.payload as any).buyerId}`,
        );
      } else if (event.name === "PurchaseRejected") {
        console.log(
          `  ${event.name} — buyer: ${(event.payload as any).buyerId} (${(event.payload as any).reason})`,
        );
      }
    }
    console.log(
      `\nSummary: ${purchased.length} purchased, ${rejectedEvents.length} rejected (out of ${buyers.length} attempts)`,
    );
    console.log(`Stock remaining: ${5 - purchased.length}`);

    await pool.end();
  } finally {
    // Step 8: Cleanup
    console.log("\nStopping PostgreSQL container...");
    await container.stop();
    console.log("Done!");
  }
}

main().catch(console.error);
