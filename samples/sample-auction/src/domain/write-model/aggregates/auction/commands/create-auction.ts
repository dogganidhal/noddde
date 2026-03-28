/** Payload for the CreateAuction command. */
export interface CreateAuctionPayload {
  /** The item to auction. */
  item: string;
  /** The minimum starting price. */
  startingPrice: number;
  /** When the auction should end. */
  endsAt: Date;
}
