import type { InferEvolveHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const evolvePaymentFailed: InferEvolveHandler<
  BookingDef,
  "PaymentFailed"
> = (_event, state) => ({
  ...state,
  status: "pending" as const,
  paymentId: null,
});
