import type { InferApplyHandler } from "@noddde/core";
import type { FlashSaleItemTypes } from "../flash-sale-item";

/** Applies the FlashSaleCreated event to produce the initial flash sale state. */
export const applyFlashSaleCreated: InferApplyHandler<
  FlashSaleItemTypes,
  "FlashSaleCreated"
> = (payload) => ({
  stock: payload.initialStock,
  sold: 0,
  buyers: [],
});
