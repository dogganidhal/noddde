import type { BookingCreatedPayload } from "../../../../event-model";
import type { GuestHistoryView } from "../guest-history";

/** View reducer for BookingCreated events. */
export const onBookingCreated = (
  event: { name: "BookingCreated"; payload: BookingCreatedPayload },
  view: GuestHistoryView,
): GuestHistoryView => ({
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
});
