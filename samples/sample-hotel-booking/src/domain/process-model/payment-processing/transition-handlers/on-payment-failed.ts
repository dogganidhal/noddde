import type { PaymentProcessingState } from "../state";

/** Transition handler for PaymentFailed: marks payment as failed. */
export const onPaymentFailed = (
  _event: { payload: { bookingId: string; paymentId: string; reason: string } },
  state: PaymentProcessingState,
) => ({
  state: { ...state, status: "failed" as const },
});
