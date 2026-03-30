import type { InferCommandHandler } from "@noddde/core";
import type { FlashSaleItemTypes } from "../flash-sale-item";

/** Handles the CreateFlashSale command by emitting a FlashSaleCreated event. */
export const handleCreateFlashSale: InferCommandHandler<
  FlashSaleItemTypes,
  "CreateFlashSale"
> = (command) => ({
  name: "FlashSaleCreated",
  payload: {
    itemId: command.targetAggregateId,
    initialStock: command.payload.initialStock,
  },
});
