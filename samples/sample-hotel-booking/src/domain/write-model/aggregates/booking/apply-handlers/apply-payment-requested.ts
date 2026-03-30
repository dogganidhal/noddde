import type { InferApplyHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const applyPaymentRequested: InferApplyHandler<
  BookingDef,
  "PaymentRequested"
> = (event, state) => ({
  ...state,
  status: "awaiting_payment" as const,
  paymentId: event.paymentId,
});
