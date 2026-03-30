import type { InferEvolveHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/** Evolves the BidPlaced event by updating the highest bid and incrementing bid count. */
export const evolveBidPlaced: InferEvolveHandler<AuctionDef, "BidPlaced"> = (
  event,
  state,
) => ({
  ...state,
  highestBid: { bidderId: event.bidderId, amount: event.amount },
  bidCount: state.bidCount + 1,
});
