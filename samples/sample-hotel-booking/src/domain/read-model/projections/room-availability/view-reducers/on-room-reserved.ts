import type { RoomReservedPayload } from "../../../../event-model";
import type { RoomAvailabilityView } from "../room-availability";

/** View reducer for RoomReserved events. */
export const onRoomReserved = (
  event: { name: "RoomReserved"; payload: RoomReservedPayload },
  view: RoomAvailabilityView,
): RoomAvailabilityView => ({
  ...view,
  status: "reserved",
  currentGuestId: event.payload.guestId,
});
