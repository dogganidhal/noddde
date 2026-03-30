import type { InferEvolveHandler } from "@noddde/core";
import type { FlashSaleItemTypes } from "../flash-sale-item";

/** Evolves state for the PurchaseRejected event — no state change. */
export const evolvePurchaseRejected: InferEvolveHandler<
  FlashSaleItemTypes,
  "PurchaseRejected"
> = (_payload, state) => state;
