import type { RoomUnderMaintenancePayload } from "../../../../event-model";
import type { RoomAvailabilityView } from "../room-availability";

/** View reducer for RoomUnderMaintenance events. */
export const onRoomUnderMaintenance = (
  _event: {
    name: "RoomUnderMaintenance";
    payload: RoomUnderMaintenancePayload;
  },
  view: RoomAvailabilityView,
): RoomAvailabilityView => ({
  ...view,
  status: "maintenance",
  currentGuestId: null,
});
