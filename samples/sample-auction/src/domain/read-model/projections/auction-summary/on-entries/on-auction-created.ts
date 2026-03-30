import type { AuctionSummaryView } from "../auction-summary";
import type { AuctionCreatedPayload } from "../../../../event-model";

/**
 * Initializes the auction summary view from an AuctionCreated event.
 * The auctionId is derived from the event's metadata.aggregateId,
 * which the engine populates at dispatch time. For testProjection
 * usage, the reducer receives the initialView set by the test harness.
 */
export const onAuctionCreated = (
  event: { name: "AuctionCreated"; payload: AuctionCreatedPayload },
  view: AuctionSummaryView,
): AuctionSummaryView => ({
  ...view,
  item: event.payload.item,
  currentHighBid: null,
  currentLeader: null,
  bidCount: 0,
  status: "open",
});
