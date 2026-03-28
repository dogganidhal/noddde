import type { PaymentProcessingState } from "../state";

/** Transition handler for PaymentCompleted: marks payment as completed. */
export const onPaymentCompleted = (
  _event: {
    payload: {
      bookingId: string;
      paymentId: string;
      transactionId: string;
      amount: number;
      completedAt: string;
    };
  },
  state: PaymentProcessingState,
) => ({
  state: { ...state, status: "completed" as const },
});
