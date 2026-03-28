import type { DefineCommands } from "@noddde/core";
import type { CreateFlashSalePayload } from "./create-flash-sale";
import type { PurchaseItemPayload } from "./purchase-item";

export type { CreateFlashSalePayload } from "./create-flash-sale";
export type { PurchaseItemPayload } from "./purchase-item";

/** Discriminated union of all flash sale item commands. */
export type FlashSaleCommand = DefineCommands<{
  CreateFlashSale: CreateFlashSalePayload;
  PurchaseItem: PurchaseItemPayload;
}>;
