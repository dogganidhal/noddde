import { Auction } from "./write-model";
import { AuctionSummaryProjection } from "./read-model/projections/auction-summary";

export { Auction } from "./write-model";
export { AuctionSummaryProjection } from "./read-model/projections/auction-summary";

/**
 * All aggregate definitions for the auction domain.
 * Used by defineDomain in main.ts.
 */
export const aggregates = { Auction } as const;

/**
 * All projection definitions for the auction domain.
 * Used by defineDomain in main.ts.
 */
export const projections = {
  AuctionSummary: AuctionSummaryProjection,
} as const;
