import type { InferSagaOnEntry } from "@noddde/core";
import type { BookingFulfillmentDef } from "../saga";

export const onPaymentRefunded: InferSagaOnEntry<
  BookingFulfillmentDef,
  "PaymentRefunded"
> = {
  id: (event) => event.payload.bookingId,
  handle: (_event, state) => ({
    state: { ...state, status: "cancelled" as const },
  }),
};
