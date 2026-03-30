import type { InferEvolveHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const evolveGuestCheckedIn: InferEvolveHandler<
  RoomDef,
  "GuestCheckedIn"
> = (_event, state) => ({
  ...state,
  status: "occupied" as const,
});
