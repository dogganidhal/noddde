import type { InferEvolveHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const evolvePaymentRequested: InferEvolveHandler<
  BookingDef,
  "PaymentRequested"
> = (event, state) => ({
  ...state,
  status: "awaiting_payment" as const,
  paymentId: event.paymentId,
});
