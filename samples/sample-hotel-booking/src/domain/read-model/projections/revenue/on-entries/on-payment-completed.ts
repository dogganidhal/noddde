import type { InferProjectionEventHandler } from "@noddde/core";
import type { RevenueProjectionDef } from "../revenue";

/** Event handler for PaymentCompleted events in the Revenue projection. */
export const onPaymentCompleted: InferProjectionEventHandler<
  RevenueProjectionDef,
  "PaymentCompleted"
> = {
  id: (event) => event.payload.completedAt.split("T")[0]!,
  reduce: (event, view) => ({
    date: event.payload.completedAt.split("T")[0]!,
    totalRevenue: view.totalRevenue + event.payload.amount,
    bookingCount: view.bookingCount + 1,
  }),
};
