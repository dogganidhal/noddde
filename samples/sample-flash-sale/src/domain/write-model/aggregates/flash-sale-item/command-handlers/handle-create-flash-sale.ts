import type { FlashSaleEvent } from "../../../../event-model";

/** Handles the CreateFlashSale command by emitting a FlashSaleCreated event. */
export const handleCreateFlashSale = (command: {
  targetAggregateId: string;
  payload: { initialStock: number };
}): FlashSaleEvent => ({
  name: "FlashSaleCreated",
  payload: {
    itemId: command.targetAggregateId,
    initialStock: command.payload.initialStock,
  },
});
