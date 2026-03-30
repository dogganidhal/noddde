import type { InferEvolveHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const evolvePaymentRefunded: InferEvolveHandler<
  BookingDef,
  "PaymentRefunded"
> = (_event, state) => ({
  ...state,
  transactionId: null,
});
