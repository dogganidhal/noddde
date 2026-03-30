import type { InferSagaOnEntry } from "@noddde/core";
import type { BookingFulfillmentDef } from "../saga";

export const onPaymentRequested: InferSagaOnEntry<
  BookingFulfillmentDef,
  "PaymentRequested"
> = {
  id: (event) => event.payload.bookingId,
  handle: (_event, state) => ({ state }),
};
