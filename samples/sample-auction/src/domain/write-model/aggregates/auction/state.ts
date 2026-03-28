/** The state of an auction aggregate instance. */
export interface AuctionState {
  /** The item being auctioned. */
  item: string;
  /** The minimum starting price for the first bid. */
  startingPrice: number;
  /** When the auction ends (bids after this time are rejected). */
  endsAt: Date;
  /** Whether the auction is open for bids or has been closed. */
  status: "open" | "closed";
  /** The current highest bid, or null if no valid bids have been placed. */
  highestBid: { bidderId: string; amount: number } | null;
  /** Total number of accepted bids (excludes rejected bids). */
  bidCount: number;
}

/** The initial (zero-value) state for a new auction aggregate. */
export const initialAuctionState: AuctionState = {
  item: "",
  startingPrice: 0,
  endsAt: new Date(0),
  status: "open",
  highestBid: null,
  bidCount: 0,
};
