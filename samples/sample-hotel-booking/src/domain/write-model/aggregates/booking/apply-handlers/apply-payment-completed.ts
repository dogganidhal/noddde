import type { InferApplyHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const applyPaymentCompleted: InferApplyHandler<
  BookingDef,
  "PaymentCompleted"
> = (event, state) => ({
  ...state,
  transactionId: event.transactionId,
});
