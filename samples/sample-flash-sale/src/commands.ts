import type { DefineCommands } from "@noddde/core";

export type FlashSaleCommand = DefineCommands<{
  CreateFlashSale: { initialStock: number };
  PurchaseItem: { buyerId: string; quantity: number };
}>;
