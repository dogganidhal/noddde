import type { InferCommandHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Handles the RequestPayment command by emitting a PaymentRequested event. */
export const handleRequestPayment: InferCommandHandler<
  BookingDef,
  "RequestPayment"
> = (command, state) => {
  if (state.status !== "pending") {
    throw new Error(`Cannot request payment in ${state.status} status`);
  }
  return {
    name: "PaymentRequested",
    payload: {
      bookingId: command.targetAggregateId,
      guestId: state.guestId!,
      paymentId: command.payload.paymentId,
      amount: command.payload.amount,
    },
  };
};
