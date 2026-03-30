import type { InferSagaOnEntry } from "@noddde/core";
import type { PaymentProcessingDef } from "../saga";

export const onPaymentFailed: InferSagaOnEntry<
  PaymentProcessingDef,
  "PaymentFailed"
> = {
  id: (event) => event.payload.bookingId,
  handle: (_event, state) => ({
    state: { ...state, status: "failed" as const },
  }),
};
