import type { InferProjectionEventHandler } from "@noddde/core";
import type { RoomAvailabilityProjectionDef } from "../room-availability";

/** Event handler for RoomReserved events in the RoomAvailability projection. */
export const onRoomReserved: InferProjectionEventHandler<
  RoomAvailabilityProjectionDef,
  "RoomReserved"
> = {
  id: (event) => event.payload.roomId,
  reduce: (event, view) => ({
    ...view,
    status: "reserved",
    currentGuestId: event.payload.guestId,
  }),
};
