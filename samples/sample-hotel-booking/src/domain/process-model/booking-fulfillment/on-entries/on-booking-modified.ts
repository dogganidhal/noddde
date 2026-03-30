import type { InferSagaOnEntry } from "@noddde/core";
import type { BookingFulfillmentDef } from "../saga";

export const onBookingModified: InferSagaOnEntry<
  BookingFulfillmentDef,
  "BookingModified"
> = {
  id: (event) => event.payload.bookingId,
  handle: (event, state) => ({
    state: {
      ...state,
      checkIn: event.payload.newCheckIn,
      checkOut: event.payload.newCheckOut,
      totalAmount: event.payload.newTotalAmount,
    },
  }),
};
