import type { BookingFulfillmentState } from "../state";

/** Transition handler for PaymentRequested: observed for state tracking, no commands. */
export const onPaymentRequested = (
  _event: {
    payload: {
      bookingId: string;
      guestId: string;
      paymentId: string;
      amount: number;
    };
  },
  state: BookingFulfillmentState,
) => ({ state });
