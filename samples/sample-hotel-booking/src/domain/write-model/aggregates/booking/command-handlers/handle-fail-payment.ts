import type { InferCommandHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Handles the FailPayment command by emitting a PaymentFailed event. */
export const handleFailPayment: InferCommandHandler<
  BookingDef,
  "FailPayment"
> = (command, state) => {
  if (state.status !== "awaiting_payment") {
    throw new Error(`Cannot fail payment in ${state.status} status`);
  }
  return {
    name: "PaymentFailed",
    payload: {
      bookingId: command.targetAggregateId,
      paymentId: command.payload.paymentId,
      reason: command.payload.reason,
    },
  };
};
