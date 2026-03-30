import { defineAggregate } from "@noddde/core";
import type { AggregateTypes, Infrastructure } from "@noddde/core";
import type { FlashSaleEvent } from "../../../event-model";
import type { FlashSaleCommand } from "./commands";
import type { FlashSaleState } from "./state";
import { initialFlashSaleState } from "./state";
import { decideCreateFlashSale } from "./deciders/decide-create-flash-sale";
import { decidePurchaseItem } from "./deciders/decide-purchase-item";
import {
  evolveFlashSaleCreated,
  evolveItemPurchased,
  evolvePurchaseRejected,
} from "./evolvers";

/** Type bundle for the FlashSaleItem aggregate. */
export type FlashSaleItemTypes = AggregateTypes & {
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
  decide: {
    CreateFlashSale: decideCreateFlashSale,
    PurchaseItem: decidePurchaseItem,
  },
  evolve: {
    FlashSaleCreated: evolveFlashSaleCreated,
    ItemPurchased: evolveItemPurchased,
    PurchaseRejected: evolvePurchaseRejected,
  },
});
