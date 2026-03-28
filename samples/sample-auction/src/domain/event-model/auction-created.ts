/** Payload for the AuctionCreated event. */
export interface AuctionCreatedPayload {
  /** The item being auctioned. */
  item: string;
  /** The minimum starting price. */
  startingPrice: number;
  /** When the auction ends. */
  endsAt: Date;
}
