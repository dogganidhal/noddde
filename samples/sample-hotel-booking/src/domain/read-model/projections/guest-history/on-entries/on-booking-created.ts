import type { InferProjectionEventHandler } from "@noddde/core";
import type { GuestHistoryProjectionDef } from "../guest-history";

/** Event handler for BookingCreated events in the GuestHistory projection. */
export const onBookingCreated: InferProjectionEventHandler<
  GuestHistoryProjectionDef,
  "BookingCreated"
> = {
  id: (event) => event.payload.guestId,
  reduce: (event, view) => ({
    guestId: event.payload.guestId,
    bookings: [
      ...view.bookings,
      {
        bookingId: event.payload.bookingId,
        roomType: event.payload.roomType,
        checkIn: event.payload.checkIn,
        checkOut: event.payload.checkOut,
        status: "pending",
      },
    ],
  }),
};
