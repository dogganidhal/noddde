import type { InferCommandHandler } from "@noddde/core";
import type { RoomDef } from "../room";

/** Handles the CheckInGuest command by emitting a GuestCheckedIn event. */
export const handleCheckInGuest: InferCommandHandler<
  RoomDef,
  "CheckInGuest"
> = (command, state, { clock }) => {
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
