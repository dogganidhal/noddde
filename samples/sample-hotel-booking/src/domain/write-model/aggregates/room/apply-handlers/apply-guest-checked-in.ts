import type { InferApplyHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const applyGuestCheckedIn: InferApplyHandler<
  RoomDef,
  "GuestCheckedIn"
> = (_event, state) => ({
  ...state,
  status: "occupied" as const,
});
