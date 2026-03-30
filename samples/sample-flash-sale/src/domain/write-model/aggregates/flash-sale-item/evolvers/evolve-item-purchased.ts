import type { InferEvolveHandler } from "@noddde/core";
import type { FlashSaleItemTypes } from "../flash-sale-item";

/** Evolves state for the ItemPurchased event by decrementing stock, incrementing sold, and recording the buyer. */
export const evolveItemPurchased: InferEvolveHandler<
  FlashSaleItemTypes,
  "ItemPurchased"
> = (payload, state) => ({
  stock: state.stock - payload.quantity,
  sold: state.sold + payload.quantity,
  buyers: [...state.buyers, payload.buyerId],
});
