import type { DefineEvents } from "@noddde/core";

export type FlashSaleEvent = DefineEvents<{
  FlashSaleCreated: { itemId: string; initialStock: number };
  ItemPurchased: { buyerId: string; quantity: number };
  PurchaseRejected: { buyerId: string; reason: string };
}>;
