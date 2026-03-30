import type { InferApplyHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const applyBookingConfirmed: InferApplyHandler<
  BookingDef,
  "BookingConfirmed"
> = (event, state) => ({
  ...state,
  status: "confirmed" as const,
  roomId: event.roomId,
});
