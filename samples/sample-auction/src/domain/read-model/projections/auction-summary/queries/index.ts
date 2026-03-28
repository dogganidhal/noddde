import { DefineQueries } from "@noddde/core";
import type { AuctionSummaryView } from "../auction-summary";

export type { GetAuctionSummaryPayload } from "./get-auction-summary";

/** Query union for the auction summary projection. */
export type AuctionSummaryQuery = DefineQueries<{
  GetAuctionSummary: {
    payload: { auctionId: string };
    result: AuctionSummaryView | null;
  };
}>;
