import type { InferCommandHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Handles the ConfirmBooking command by emitting a BookingConfirmed event. */
export const handleConfirmBooking: InferCommandHandler<
  BookingDef,
  "ConfirmBooking"
> = (command, state, { clock }) => {
  if (state.status !== "awaiting_payment" && state.status !== "pending") {
    throw new Error(`Cannot confirm booking in ${state.status} status`);
  }
  return {
    name: "BookingConfirmed",
    payload: {
      bookingId: command.targetAggregateId,
      roomId: command.payload.roomId,
      confirmedAt: clock.now().toISOString(),
    },
  };
};
