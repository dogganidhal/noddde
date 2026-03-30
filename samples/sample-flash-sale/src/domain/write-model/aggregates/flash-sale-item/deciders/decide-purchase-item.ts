import type { InferDecideHandler } from "@noddde/core";
import type { FlashSaleItemTypes } from "../flash-sale-item";

/** Decides the PurchaseItem command. Rejects when stock is depleted. */
export const decidePurchaseItem: InferDecideHandler<
  FlashSaleItemTypes,
  "PurchaseItem"
> = (command, state) => {
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
