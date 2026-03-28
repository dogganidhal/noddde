/** Flash sale item aggregate state. */
export interface FlashSaleState {
  /** Number of items remaining in stock. */
  stock: number;
  /** Number of items sold so far. */
  sold: number;
  /** Ordered list of buyer identifiers who completed a purchase. */
  buyers: string[];
}

/** Initial state for a new flash sale item aggregate. */
export const initialFlashSaleState: FlashSaleState = {
  stock: 0,
  sold: 0,
  buyers: [],
};
