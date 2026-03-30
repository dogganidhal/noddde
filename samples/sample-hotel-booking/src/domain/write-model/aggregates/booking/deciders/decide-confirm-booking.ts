import type { InferDecideHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Decides the ConfirmBooking command by emitting a BookingConfirmed event. */
export const decideConfirmBooking: InferDecideHandler<
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
