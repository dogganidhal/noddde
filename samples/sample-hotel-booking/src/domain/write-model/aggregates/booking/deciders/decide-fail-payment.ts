import type { InferDecideHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Decides the FailPayment command by emitting a PaymentFailed event. */
export const decideFailPayment: InferDecideHandler<
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
