import type { InferEvolveHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const evolveRoomReserved: InferEvolveHandler<RoomDef, "RoomReserved"> = (
  event,
  state,
) => ({
  ...state,
  status: "reserved" as const,
  currentBookingId: event.bookingId,
  currentGuestId: event.guestId,
});
