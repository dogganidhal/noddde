import type { InferSagaOnEntry } from "@noddde/core";
import type { BookingFulfillmentDef } from "../saga";

export const onBookingConfirmed: InferSagaOnEntry<
  BookingFulfillmentDef,
  "BookingConfirmed"
> = {
  id: (event) => event.payload.bookingId,
  handle: (_event, state) => ({
    state: { ...state, status: "confirmed" as const },
  }),
};
