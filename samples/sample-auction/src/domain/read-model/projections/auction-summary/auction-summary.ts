/** Read-optimized view summarizing an auction's current state. */
export interface AuctionSummaryView {
  /** The auction identifier. */
  auctionId: string;
  /** The item being auctioned. */
  item: string;
  /** The current highest bid amount, or null if no bids. */
  currentHighBid: number | null;
  /** The current leading bidder, or null if no bids. */
  currentLeader: string | null;
  /** Total number of accepted bids. */
  bidCount: number;
  /** Whether the auction is open or closed. */
  status: "open" | "closed";
}

/** Initial (empty) view for a new auction summary. */
export const initialAuctionSummaryView: AuctionSummaryView = {
  auctionId: "",
  item: "",
  currentHighBid: null,
  currentLeader: null,
  bidCount: 0,
  status: "open",
};
