import type { BookingFulfillmentState } from "../state";

/** Transition handler for BookingCancelled: refunds if payment was completed. */
export const onBookingCancelled = (
  _event: {
    payload: { bookingId: string; reason: string; cancelledAt: string };
  },
  state: BookingFulfillmentState,
) => ({
  state: { ...state, status: "cancelled" as const },
  commands:
    state.status === "confirmed" && state.paymentId
      ? {
          name: "RefundPayment" as const,
          targetAggregateId: state.bookingId,
          payload: {
            paymentId: state.paymentId,
            amount: state.totalAmount,
          },
        }
      : undefined,
});
