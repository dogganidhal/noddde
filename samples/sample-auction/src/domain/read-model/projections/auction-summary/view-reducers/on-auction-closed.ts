import type { AuctionSummaryView } from "../auction-summary";
import type { AuctionClosedPayload } from "../../../../event-model";

/**
 * Updates the auction summary when the auction is closed.
 * Sets the status to "closed" — the winner info is already
 * reflected via the highest bid tracking.
 */
export const onAuctionClosed = (
  _event: { name: "AuctionClosed"; payload: AuctionClosedPayload },
  view: AuctionSummaryView,
): AuctionSummaryView => ({
  ...view,
  status: "closed",
});
