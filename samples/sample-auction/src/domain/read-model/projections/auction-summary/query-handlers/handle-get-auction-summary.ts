import type { ViewStore } from "@noddde/core";
import type { AuctionSummaryView } from "../auction-summary";
import type { AuctionPorts } from "../../../../../infrastructure";

/**
 * Handles GetAuctionSummary by loading the view from the store.
 * Returns null when no view exists for the given auction.
 */
export const handleGetAuctionSummary = async (
  query: { auctionId: string },
  { views }: AuctionPorts & { views: ViewStore<AuctionSummaryView> },
): Promise<AuctionSummaryView | null> =>
  (await views.load(query.auctionId)) ?? null;
