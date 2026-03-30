import type { InferDecideHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Decides the ModifyBooking command by emitting a BookingModified event. */
export const decideModifyBooking: InferDecideHandler<
  BookingDef,
  "ModifyBooking"
> = (command, state, { clock }) => {
  if (state.status === "cancelled") {
    throw new Error("Cannot modify cancelled booking");
  }
  return {
    name: "BookingModified",
    payload: {
      bookingId: command.targetAggregateId,
      newCheckIn: command.payload.newCheckIn,
      newCheckOut: command.payload.newCheckOut,
      newTotalAmount: command.payload.newTotalAmount,
      modifiedAt: clock.now().toISOString(),
    },
  };
};
