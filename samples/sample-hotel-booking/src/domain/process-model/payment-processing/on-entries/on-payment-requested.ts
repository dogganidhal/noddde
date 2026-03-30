import type { InferSagaOnEntry } from "@noddde/core";
import type { PaymentProcessingDef } from "../saga";

export const onPaymentRequested: InferSagaOnEntry<
  PaymentProcessingDef,
  "PaymentRequested"
> = {
  id: (event) => event.payload.bookingId,
  handle: async (event, _state, { paymentGateway }) => {
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
        },
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
        },
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
  },
};
