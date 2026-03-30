import type { InferProjectionEventHandler } from "@noddde/core";
import type { RoomAvailabilityProjectionDef } from "../room-availability";

/** Event handler for GuestCheckedOut events in the RoomAvailability projection. */
export const onGuestCheckedOut: InferProjectionEventHandler<
  RoomAvailabilityProjectionDef,
  "GuestCheckedOut"
> = {
  id: (event) => event.payload.roomId,
  reduce: (_event, view) => ({
    ...view,
    status: "available",
    currentGuestId: null,
  }),
};
