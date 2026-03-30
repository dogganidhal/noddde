import type { InferApplyHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const applyGuestCheckedOut: InferApplyHandler<
  RoomDef,
  "GuestCheckedOut"
> = (_event, state) => ({
  ...state,
  status: "available" as const,
  currentBookingId: null,
  currentGuestId: null,
});
