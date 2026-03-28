import type { BookingFulfillmentState } from "../state";

/** Transition handler for BookingConfirmed: updates state to confirmed. */
export const onBookingConfirmed = (
  _event: {
    payload: { bookingId: string; roomId: string; confirmedAt: string };
  },
  state: BookingFulfillmentState,
) => ({
  state: { ...state, status: "confirmed" as const },
});
