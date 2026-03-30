import type { InferEvolveHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/** Evolves the AuctionCreated event to produce the initial open auction state. */
export const evolveAuctionCreated: InferEvolveHandler<
  AuctionDef,
  "AuctionCreated"
> = (event) => ({
  item: event.item,
  startingPrice: event.startingPrice,
  endsAt: event.endsAt,
  status: "open" as const,
  highestBid: null,
  bidCount: 0,
});
