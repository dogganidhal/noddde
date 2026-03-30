import type { InferApplyHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/** Applies the AuctionCreated event to produce the initial open auction state. */
export const applyAuctionCreated: InferApplyHandler<
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
