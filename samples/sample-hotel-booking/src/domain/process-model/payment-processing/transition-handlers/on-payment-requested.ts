import type { PaymentProcessingState } from "../state";

/** Transition handler for PaymentRequested: charges via payment gateway. */
export const onPaymentRequested = async (
  event: {
    payload: {
      bookingId: string;
      guestId: string;
      paymentId: string;
      amount: number;
    };
  },
  _state: PaymentProcessingState,
  {
    paymentGateway,
  }: {
    paymentGateway: {
      charge(
        guestId: string,
        amount: number,
      ): Promise<{ transactionId: string }>;
    };
  },
) => {
  try {
    const { transactionId } = await paymentGateway.charge(
      event.payload.guestId,
      event.payload.amount,
    );

    return {
      state: {
        bookingId: event.payload.bookingId,
        guestId: event.payload.guestId,
        paymentId: event.payload.paymentId,
        amount: event.payload.amount,
        status: "charging" as const,
      } satisfies PaymentProcessingState,
      commands: {
        name: "CompletePayment" as const,
        targetAggregateId: event.payload.bookingId,
        payload: {
          paymentId: event.payload.paymentId,
          transactionId,
          amount: event.payload.amount,
        },
      },
    };
  } catch (error: any) {
    return {
      state: {
        bookingId: event.payload.bookingId,
        guestId: event.payload.guestId,
        paymentId: event.payload.paymentId,
        amount: event.payload.amount,
        status: "failed" as const,
      } satisfies PaymentProcessingState,
      commands: {
        name: "FailPayment" as const,
        targetAggregateId: event.payload.bookingId,
        payload: {
          paymentId: event.payload.paymentId,
          reason: error.message ?? "Payment gateway error",
        },
      },
    };
  }
};
