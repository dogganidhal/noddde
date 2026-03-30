import type { AuctionSummaryView } from "../auction-summary";
import type { BidPlacedPayload } from "../../../../event-model";

/**
 * Updates the auction summary when a bid is placed.
 * Tracks the new highest bid, leader, and increments the bid count.
 */
export const onBidPlaced = (
  event: { name: "BidPlaced"; payload: BidPlacedPayload },
  view: AuctionSummaryView,
): AuctionSummaryView => ({
  ...view,
  currentHighBid: event.payload.amount,
  currentLeader: event.payload.bidderId,
  bidCount: view.bidCount + 1,
});
