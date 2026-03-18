/**
 * Auction Sample — Drizzle Adapter
 *
 * Demonstrates @noddde/drizzle with SQLite for persistence.
 * A simple auction domain with a single aggregate.
 */
import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createDrizzlePersistence } from "@noddde/drizzle";
import { events, aggregateStates, sagaStates } from "@noddde/drizzle/sqlite";
import { Auction } from "./aggregate";
import { AuctionInfrastructure, SystemClock } from "./infrastructure";
import { randomUUID } from "crypto";

const main = async () => {
  // ── Set up Drizzle with SQLite ───────────────────────────────
  const sqlite = new Database("auction.db");
  sqlite.exec(`
    CREATE TABLE noddde_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE noddde_aggregate_states (
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (aggregate_name, aggregate_id)
    );
    CREATE TABLE noddde_saga_states (
      saga_name TEXT NOT NULL,
      saga_id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (saga_name, saga_id)
    );
  `);
  const db = drizzle(sqlite);
  const drizzleInfra = createDrizzlePersistence(db, {
    events,
    aggregateStates,
    sagaStates,
  });

  // ── Configure the domain with Drizzle persistence ────────────
  const domain = await configureDomain<AuctionInfrastructure>({
    writeModel: {
      aggregates: { Auction },
    },
    readModel: {
      projections: {},
    },
    infrastructure: {
      aggregatePersistence: () => drizzleInfra.eventSourcedPersistence,
      unitOfWorkFactory: () => drizzleInfra.unitOfWorkFactory,
      provideInfrastructure: () => ({
        clock: new SystemClock(),
      }),
      cqrsInfrastructure: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    },
  });

  // ── Run the auction scenario ─────────────────────────────────
  const auctionId = randomUUID();

  await domain.dispatchCommand({
    name: "CreateAuction",
    targetAggregateId: auctionId,
    payload: {
      item: "Vintage Guitar",
      startingPrice: 500,
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await domain.dispatchCommand({
    name: "PlaceBid",
    targetAggregateId: auctionId,
    payload: { bidderId: "alice", amount: 550 },
  });

  await domain.dispatchCommand({
    name: "PlaceBid",
    targetAggregateId: auctionId,
    payload: { bidderId: "bob", amount: 600 },
  });

  // This bid should be rejected — below current highest
  await domain.dispatchCommand({
    name: "PlaceBid",
    targetAggregateId: auctionId,
    payload: { bidderId: "charlie", amount: 580 },
  });

  await domain.dispatchCommand({
    name: "CloseAuction",
    targetAggregateId: auctionId,
  });

  console.log("✅ Auction sample completed (Drizzle + SQLite)");
};

main();
