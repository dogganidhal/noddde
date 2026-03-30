import type { InferDecideHandler } from "@noddde/core";
import type { RoomDef } from "../room";

/** Decides the CheckInGuest command by emitting a GuestCheckedIn event. */
export const decideCheckInGuest: InferDecideHandler<RoomDef, "CheckInGuest"> = (
  command,
  state,
  { clock },
) => {
  if (state.status !== "reserved") {
    throw new Error(`Cannot check in to room in ${state.status} status`);
  }
  if (state.currentBookingId !== command.payload.bookingId) {
    throw new Error("Booking ID does not match reservation");
  }
  return {
    name: "GuestCheckedIn",
    payload: {
      roomId: command.targetAggregateId,
      bookingId: command.payload.bookingId,
      guestId: command.payload.guestId,
      checkedInAt: clock.now().toISOString(),
    },
  };
};
