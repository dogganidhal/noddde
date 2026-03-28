/** Payload for the BidRejected event. */
export interface BidRejectedPayload {
  /** The bidder whose bid was rejected. */
  bidderId: string;
  /** The rejected bid amount. */
  amount: number;
  /** Human-readable rejection reason. */
  reason: string;
}
