import type { InferApplyHandler } from "@noddde/core";
import type { AuctionDef } from "../auction";

/** Applies the BidPlaced event by updating the highest bid and incrementing bid count. */
export const applyBidPlaced: InferApplyHandler<AuctionDef, "BidPlaced"> = (
  event,
  state,
) => ({
  ...state,
  highestBid: { bidderId: event.bidderId, amount: event.amount },
  bidCount: state.bidCount + 1,
});
