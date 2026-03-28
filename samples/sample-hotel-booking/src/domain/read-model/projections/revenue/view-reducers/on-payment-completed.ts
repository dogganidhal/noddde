import type { PaymentCompletedPayload } from "../../../../event-model";
import type { RevenueView } from "../revenue";

/** View reducer for PaymentCompleted events. */
export const onPaymentCompleted = (
  event: { name: "PaymentCompleted"; payload: PaymentCompletedPayload },
  view: RevenueView,
): RevenueView => ({
  date: event.payload.completedAt.split("T")[0]!,
  totalRevenue: view.totalRevenue + event.payload.amount,
  bookingCount: view.bookingCount + 1,
});
