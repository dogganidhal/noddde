import type { InferSagaOnEntry } from "@noddde/core";
import type { PaymentProcessingDef } from "../saga";

export const onPaymentCompleted: InferSagaOnEntry<
  PaymentProcessingDef,
  "PaymentCompleted"
> = {
  id: (event) => event.payload.bookingId,
  handle: (_event, state) => ({
    state: { ...state, status: "completed" as const },
  }),
};
