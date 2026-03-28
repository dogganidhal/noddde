import type { RoomMadeAvailablePayload } from "../../../../event-model";
import type { RoomAvailabilityView } from "../room-availability";

/** View reducer for RoomMadeAvailable events. */
export const onRoomMadeAvailable = (
  _event: { name: "RoomMadeAvailable"; payload: RoomMadeAvailablePayload },
  view: RoomAvailabilityView,
): RoomAvailabilityView => ({
  ...view,
  status: "available",
  currentGuestId: null,
});
