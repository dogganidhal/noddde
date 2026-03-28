import type { DefineEvents } from "@noddde/core";
import type { FlashSaleCreatedPayload } from "./flash-sale-created";
import type { ItemPurchasedPayload } from "./item-purchased";
import type { PurchaseRejectedPayload } from "./purchase-rejected";

export type { FlashSaleCreatedPayload } from "./flash-sale-created";
export type { ItemPurchasedPayload } from "./item-purchased";
export type { PurchaseRejectedPayload } from "./purchase-rejected";

/** Discriminated union of all flash sale domain events. */
export type FlashSaleEvent = DefineEvents<{
  FlashSaleCreated: FlashSaleCreatedPayload;
  ItemPurchased: ItemPurchasedPayload;
  PurchaseRejected: PurchaseRejectedPayload;
}>;
