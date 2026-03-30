import type { InferApplyHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const applyRoomCreated: InferApplyHandler<RoomDef, "RoomCreated"> = (
  event,
) => ({
  roomNumber: event.roomNumber,
  type: event.type,
  floor: event.floor,
  pricePerNight: event.pricePerNight,
  status: "created" as const,
  currentBookingId: null,
  currentGuestId: null,
});
