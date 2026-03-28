import type { AuctionSummaryView } from "../auction-summary";

/** Payload for the GetAuctionSummary query. */
export interface GetAuctionSummaryPayload {
  /** The auction to retrieve the summary for. */
  auctionId: string;
}

/** Result type for the GetAuctionSummary query. */
export type GetAuctionSummaryResult = AuctionSummaryView | null;
