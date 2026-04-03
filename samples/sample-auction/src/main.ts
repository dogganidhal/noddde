/**
 * Auction Sample
 *
 * Demonstrates @noddde with Prisma Adapter + SQLite for persistence,
 * including a projection and upcasters.
 */
import {
  defineDomain,
  wireDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryViewStore,
} from "@noddde/engine";
import { PrismaClient } from "@prisma/client";
import { createPrismaAdapter } from "@noddde/prisma";
import { randomUUID } from "crypto";

import { SystemClock } from "./infrastructure";
import { aggregates, projections } from "./domain/domain";

const main = async () => {
  // ── Set up Prisma with SQLite ────────────────────────────────
  const prisma = new PrismaClient();
  const prismaInfra = createPrismaAdapter(prisma);

  // ── Define the domain structure (pure, sync) ────────────────
  const auctionDomain = defineDomain({
    writeModel: { aggregates },
    readModel: { projections },
  });

  // ── Wire with infrastructure (async) ───────────────────────
  const domain = await wireDomain(auctionDomain, {
    infrastructure: () => ({
      clock: new SystemClock(),
    }),
    aggregates: {
      persistence: () => prismaInfra.eventSourcedPersistence,
    },
    buses: () => ({
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    }),
    projections: {
      AuctionSummary: {
        viewStore: () => new InMemoryViewStore(),
      },
    },
    unitOfWork: () => prismaInfra.unitOfWorkFactory,
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

  console.log("Auction sample completed (Prisma + SQLite)");
};

main();
