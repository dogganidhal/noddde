import type { BookingFulfillmentState } from "../state";

/** Transition handler for PaymentRefunded: marks saga as cancelled. */
export const onPaymentRefunded = (
  _event: {
    payload: {
      bookingId: string;
      paymentId: string;
      amount: number;
      refundedAt: string;
    };
  },
  state: BookingFulfillmentState,
) => ({
  state: { ...state, status: "cancelled" as const },
});
