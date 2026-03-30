import type { InferEvolveHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const evolveRoomCreated: InferEvolveHandler<RoomDef, "RoomCreated"> = (
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
