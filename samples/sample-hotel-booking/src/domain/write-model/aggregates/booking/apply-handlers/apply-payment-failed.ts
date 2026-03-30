import type { InferApplyHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const applyPaymentFailed: InferApplyHandler<
  BookingDef,
  "PaymentFailed"
> = (_event, state) => ({
  ...state,
  status: "pending" as const,
  paymentId: null,
});
