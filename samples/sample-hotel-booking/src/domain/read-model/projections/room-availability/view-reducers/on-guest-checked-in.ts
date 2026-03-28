import type { GuestCheckedInPayload } from "../../../../event-model";
import type { RoomAvailabilityView } from "../room-availability";

/** View reducer for GuestCheckedIn events. */
export const onGuestCheckedIn = (
  event: { name: "GuestCheckedIn"; payload: GuestCheckedInPayload },
  view: RoomAvailabilityView,
): RoomAvailabilityView => ({
  ...view,
  status: "occupied",
  currentGuestId: event.payload.guestId,
});
