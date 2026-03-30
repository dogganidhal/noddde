import type { InferProjectionEventHandler } from "@noddde/core";
import type { RoomAvailabilityProjectionDef } from "../room-availability";

/** Event handler for GuestCheckedIn events in the RoomAvailability projection. */
export const onGuestCheckedIn: InferProjectionEventHandler<
  RoomAvailabilityProjectionDef,
  "GuestCheckedIn"
> = {
  id: (event) => event.payload.roomId,
  reduce: (event, view) => ({
    ...view,
    status: "occupied",
    currentGuestId: event.payload.guestId,
  }),
};
