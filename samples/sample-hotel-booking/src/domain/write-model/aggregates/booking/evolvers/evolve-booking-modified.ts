import type { InferEvolveHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const evolveBookingModified: InferEvolveHandler<
  BookingDef,
  "BookingModified"
> = (event, state) => ({
  ...state,
  checkIn: event.newCheckIn,
  checkOut: event.newCheckOut,
  totalAmount: event.newTotalAmount,
});
