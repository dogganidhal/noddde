import type { InferEvolveHandler } from "@noddde/core";
import type { FlashSaleItemTypes } from "../flash-sale-item";

/** Evolves state for the FlashSaleCreated event to produce the initial flash sale state. */
export const evolveFlashSaleCreated: InferEvolveHandler<
  FlashSaleItemTypes,
  "FlashSaleCreated"
> = (payload) => ({
  stock: payload.initialStock,
  sold: 0,
  buyers: [],
});
