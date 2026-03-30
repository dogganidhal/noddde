import type { InferApplyHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const applyRoomReserved: InferApplyHandler<RoomDef, "RoomReserved"> = (
  event,
  state,
) => ({
  ...state,
  status: "reserved" as const,
  currentBookingId: event.bookingId,
  currentGuestId: event.guestId,
});
