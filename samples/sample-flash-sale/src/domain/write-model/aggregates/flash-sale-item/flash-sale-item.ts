import { defineAggregate } from "@noddde/core";
import type { AggregateTypes, Infrastructure } from "@noddde/core";
import type { FlashSaleEvent } from "../../../event-model";
import type { FlashSaleCommand } from "./commands";
import type { FlashSaleState } from "./state";
import { initialFlashSaleState } from "./state";
import { handleCreateFlashSale } from "./command-handlers/handle-create-flash-sale";
import { handlePurchaseItem } from "./command-handlers/handle-purchase-item";

/** Type bundle for the FlashSaleItem aggregate. */
type FlashSaleItemTypes = AggregateTypes & {
  state: FlashSaleState;
  events: FlashSaleEvent;
  commands: FlashSaleCommand;
  infrastructure: Infrastructure;
};

/**
 * FlashSaleItem aggregate definition.
 *
 * Models a limited-stock item in a flash sale. Tracks remaining stock,
 * total sold, and ordered buyer list. Rejects purchases when stock is
 * depleted with a PurchaseRejected event (no-op on state).
 */
export const FlashSaleItem = defineAggregate<FlashSaleItemTypes>({
  initialState: initialFlashSaleState,
  commands: {
    CreateFlashSale: handleCreateFlashSale,
    PurchaseItem: handlePurchaseItem,
  },
  apply: {
    FlashSaleCreated: (payload) => ({
      stock: payload.initialStock,
      sold: 0,
      buyers: [],
    }),
    ItemPurchased: (payload, state) => ({
      stock: state.stock - payload.quantity,
      sold: state.sold + payload.quantity,
      buyers: [...state.buyers, payload.buyerId],
    }),
    PurchaseRejected: (_payload, state) => state,
  },
});
