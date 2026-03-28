import type { BookingFulfillmentState } from "../state";

/** Transition handler for PaymentFailed: cancels the booking. */
export const onPaymentFailed = (
  event: { payload: { bookingId: string; paymentId: string; reason: string } },
  state: BookingFulfillmentState,
) => ({
  state: { ...state, status: "cancelled" as const },
  commands: {
    name: "CancelBooking" as const,
    targetAggregateId: state.bookingId,
    payload: { reason: `Payment failed: ${event.payload.reason}` },
  },
});
