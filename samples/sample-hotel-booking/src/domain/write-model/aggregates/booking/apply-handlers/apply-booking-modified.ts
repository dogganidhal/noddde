import type { InferApplyHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const applyBookingModified: InferApplyHandler<
  BookingDef,
  "BookingModified"
> = (event, state) => ({
  ...state,
  checkIn: event.newCheckIn,
  checkOut: event.newCheckOut,
  totalAmount: event.newTotalAmount,
});
