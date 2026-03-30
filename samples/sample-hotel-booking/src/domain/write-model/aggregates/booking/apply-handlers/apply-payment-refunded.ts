import type { InferApplyHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const applyPaymentRefunded: InferApplyHandler<
  BookingDef,
  "PaymentRefunded"
> = (_event, state) => ({
  ...state,
  transactionId: null,
});
