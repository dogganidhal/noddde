import type { InferApplyHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const applyRoomUnderMaintenance: InferApplyHandler<
  RoomDef,
  "RoomUnderMaintenance"
> = (_event, state) => ({
  ...state,
  status: "maintenance" as const,
  currentBookingId: null,
  currentGuestId: null,
});
