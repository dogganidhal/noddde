import type { BookingFulfillmentState } from "../state";

/** Transition handler for BookingModified: updates booking details in state. */
export const onBookingModified = (
  event: {
    payload: {
      bookingId: string;
      newCheckIn: string;
      newCheckOut: string;
      newTotalAmount: number;
      modifiedAt: string;
    };
  },
  state: BookingFulfillmentState,
) => ({
  state: {
    ...state,
    checkIn: event.payload.newCheckIn,
    checkOut: event.payload.newCheckOut,
    totalAmount: event.payload.newTotalAmount,
  },
});
