import type { RoomCreatedPayload } from "../../../../event-model";
import type { RoomAvailabilityView } from "../room-availability";

/** View reducer for RoomCreated events. */
export const onRoomCreated = (event: {
  name: "RoomCreated";
  payload: RoomCreatedPayload;
}): RoomAvailabilityView => ({
  roomId: event.payload.roomId,
  roomNumber: event.payload.roomNumber,
  type: event.payload.type,
  floor: event.payload.floor,
  pricePerNight: event.payload.pricePerNight,
  status: "created",
  currentGuestId: null,
});
