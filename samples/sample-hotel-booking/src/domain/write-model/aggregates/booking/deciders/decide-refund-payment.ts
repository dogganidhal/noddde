import type { InferDecideHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Decides the RefundPayment command by emitting a PaymentRefunded event. */
export const decideRefundPayment: InferDecideHandler<
  BookingDef,
  "RefundPayment"
> = (command, state, { clock }) => {
  if (state.transactionId === null) {
    throw new Error("No payment to refund");
  }
  return {
    name: "PaymentRefunded",
    payload: {
      bookingId: command.targetAggregateId,
      paymentId: command.payload.paymentId,
      amount: command.payload.amount,
      refundedAt: clock.now().toISOString(),
    },
  };
};
