import type { FlashSaleState } from "../state";
import type { FlashSaleEvent } from "../../../../event-model";

/** Handles the PurchaseItem command. Rejects when stock is depleted. */
export const handlePurchaseItem = (
  command: { payload: { buyerId: string; quantity: number } },
  state: FlashSaleState,
): FlashSaleEvent => {
  if (state.stock <= 0) {
    return {
      name: "PurchaseRejected",
      payload: { buyerId: command.payload.buyerId, reason: "out_of_stock" },
    };
  }
  return {
    name: "ItemPurchased",
    payload: {
      buyerId: command.payload.buyerId,
      quantity: command.payload.quantity,
    },
  };
};
