import type { InferApplyHandler } from "@noddde/core";
import type { FlashSaleItemTypes } from "../flash-sale-item";

/** Applies the PurchaseRejected event — no state change. */
export const applyPurchaseRejected: InferApplyHandler<
  FlashSaleItemTypes,
  "PurchaseRejected"
> = (_payload, state) => state;
