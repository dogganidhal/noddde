import type { InferDecideHandler } from "@noddde/core";
import type { FlashSaleItemTypes } from "../flash-sale-item";

/** Decides the CreateFlashSale command by emitting a FlashSaleCreated event. */
export const decideCreateFlashSale: InferDecideHandler<
  FlashSaleItemTypes,
  "CreateFlashSale"
> = (command) => ({
  name: "FlashSaleCreated",
  payload: {
    itemId: command.targetAggregateId,
    initialStock: command.payload.initialStock,
  },
});
