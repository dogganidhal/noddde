import type { InferDecideHandler } from "@noddde/core";
import type { RoomDef } from "../room";

/** Decides the CheckOutGuest command by emitting a GuestCheckedOut event. */
export const decideCheckOutGuest: InferDecideHandler<
  RoomDef,
  "CheckOutGuest"
> = (command, state, { clock }) => {
  if (state.status !== "occupied") {
    throw new Error(`Cannot check out from room in ${state.status} status`);
  }
  return {
    name: "GuestCheckedOut",
    payload: {
      roomId: command.targetAggregateId,
      bookingId: command.payload.bookingId,
      guestId: command.payload.guestId,
      checkedOutAt: clock.now().toISOString(),
    },
  };
};
