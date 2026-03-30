import type { InferProjectionEventHandler } from "@noddde/core";
import type { RoomAvailabilityProjectionDef } from "../room-availability";

/** Event handler for RoomCreated events in the RoomAvailability projection. */
export const onRoomCreated: InferProjectionEventHandler<
  RoomAvailabilityProjectionDef,
  "RoomCreated"
> = {
  id: (event) => event.payload.roomId,
  reduce: (event) => ({
    roomId: event.payload.roomId,
    roomNumber: event.payload.roomNumber,
    type: event.payload.type,
    floor: event.payload.floor,
    pricePerNight: event.payload.pricePerNight,
    status: "created",
    currentGuestId: null,
  }),
};
