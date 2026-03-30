import type { InferCommandHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Handles the CompletePayment command by emitting a PaymentCompleted event. */
export const handleCompletePayment: InferCommandHandler<
  BookingDef,
  "CompletePayment"
> = (command, state, { clock }) => {
  if (state.status !== "awaiting_payment") {
    throw new Error(`Cannot complete payment in ${state.status} status`);
  }
  return {
    name: "PaymentCompleted",
    payload: {
      bookingId: command.targetAggregateId,
      paymentId: command.payload.paymentId,
      transactionId: command.payload.transactionId,
      amount: command.payload.amount,
      completedAt: clock.now().toISOString(),
    },
  };
};
