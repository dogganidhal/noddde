/** Payload for the AuctionClosed event. */
export interface AuctionClosedPayload {
  /** The winning bidder, or null if no bids were placed. */
  winnerId: string | null;
  /** The winning bid amount, or null if no bids were placed. */
  winningBid: number | null;
}
