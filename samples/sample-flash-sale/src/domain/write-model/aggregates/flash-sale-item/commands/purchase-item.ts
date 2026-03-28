/** Payload for purchasing an item from a flash sale. */
export interface PurchaseItemPayload {
  /** Identifier of the buyer attempting the purchase. */
  buyerId: string;
  /** Number of items to purchase. */
  quantity: number;
}
