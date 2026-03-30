import type { InferEvolveHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const evolveRoomUnderMaintenance: InferEvolveHandler<
  RoomDef,
  "RoomUnderMaintenance"
> = (_event, state) => ({
  ...state,
  status: "maintenance" as const,
  currentBookingId: null,
  currentGuestId: null,
});
