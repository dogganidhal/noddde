import type { InferEvolveHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const evolveRoomMadeAvailable: InferEvolveHandler<
  RoomDef,
  "RoomMadeAvailable"
> = (_event, state) => ({
  ...state,
  status: "available" as const,
  currentBookingId: null,
  currentGuestId: null,
});
