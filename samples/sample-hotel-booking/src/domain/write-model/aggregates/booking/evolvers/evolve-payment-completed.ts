import type { InferEvolveHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const evolvePaymentCompleted: InferEvolveHandler<
  BookingDef,
  "PaymentCompleted"
> = (event, state) => ({
  ...state,
  transactionId: event.transactionId,
});
