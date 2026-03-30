import type { InferProjectionEventHandler } from "@noddde/core";
import type { RoomAvailabilityProjectionDef } from "../room-availability";

/** Event handler for RoomUnderMaintenance events in the RoomAvailability projection. */
export const onRoomUnderMaintenance: InferProjectionEventHandler<
  RoomAvailabilityProjectionDef,
  "RoomUnderMaintenance"
> = {
  id: (event) => event.payload.roomId,
  reduce: (_event, view) => ({
    ...view,
    status: "maintenance",
    currentGuestId: null,
  }),
};
