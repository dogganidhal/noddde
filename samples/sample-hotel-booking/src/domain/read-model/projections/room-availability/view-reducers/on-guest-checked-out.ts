import type { GuestCheckedOutPayload } from "../../../../event-model";
import type { RoomAvailabilityView } from "../room-availability";

/** View reducer for GuestCheckedOut events. */
export const onGuestCheckedOut = (
  _event: { name: "GuestCheckedOut"; payload: GuestCheckedOutPayload },
  view: RoomAvailabilityView,
): RoomAvailabilityView => ({
  ...view,
  status: "available",
  currentGuestId: null,
});
