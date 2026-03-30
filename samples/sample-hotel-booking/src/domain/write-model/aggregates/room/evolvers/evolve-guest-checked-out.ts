import type { InferEvolveHandler } from "@noddde/core";
import type { RoomDef } from "../room";

export const evolveGuestCheckedOut: InferEvolveHandler<
  RoomDef,
  "GuestCheckedOut"
> = (_event, state) => ({
  ...state,
  status: "available" as const,
  currentBookingId: null,
  currentGuestId: null,
});
