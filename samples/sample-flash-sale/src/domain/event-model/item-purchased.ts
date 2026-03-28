/** Payload emitted when a buyer successfully purchases an item. */
export interface ItemPurchasedPayload {
  /** Identifier of the buyer who made the purchase. */
  buyerId: string;
  /** Number of items purchased. */
  quantity: number;
}
