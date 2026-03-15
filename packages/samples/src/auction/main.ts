import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
} from "@noddde/core";
import { Auction } from "./aggregate";
import { AuctionInfrastructure, SystemClock } from "./infrastructure";
import { randomUUID } from "crypto";

const main = async () => {
  const domain = await configureDomain<AuctionInfrastructure>({
    writeModel: {
      aggregates: { Auction },
    },
    readModel: {
      projections: {},
    },
    infrastructure: {
      aggregatePersistence: () =>
        new InMemoryEventSourcedAggregatePersistence(),
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
};

main();
