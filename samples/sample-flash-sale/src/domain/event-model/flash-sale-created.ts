/** Payload emitted when a new flash sale is created. */
export interface FlashSaleCreatedPayload {
  /** Identifier of the flash sale item. */
  itemId: string;
  /** Number of items available for purchase. */
  initialStock: number;
}
