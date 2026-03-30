import type { InferProjectionEventHandler } from "@noddde/core";
import type { RoomAvailabilityProjectionDef } from "../room-availability";

/** Event handler for RoomMadeAvailable events in the RoomAvailability projection. */
export const onRoomMadeAvailable: InferProjectionEventHandler<
  RoomAvailabilityProjectionDef,
  "RoomMadeAvailable"
> = {
  id: (event) => event.payload.roomId,
  reduce: (_event, view) => ({
    ...view,
    status: "available",
    currentGuestId: null,
  }),
};
