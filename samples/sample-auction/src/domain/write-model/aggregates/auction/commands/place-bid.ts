/** Payload for the PlaceBid command. */
export interface PlaceBidPayload {
  /** The bidder placing the bid. */
  bidderId: string;
  /** The bid amount. */
  amount: number;
}
