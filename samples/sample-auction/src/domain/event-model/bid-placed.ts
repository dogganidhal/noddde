/** Payload for the BidPlaced event (current version, v2). */
export interface BidPlacedPayload {
  /** The bidder who placed the bid. */
  bidderId: string;
  /** The bid amount. */
  amount: number;
  /** When the bid was placed. */
  timestamp: Date;
}
