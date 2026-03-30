import type { InferApplyHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const applyBookingCancelled: InferApplyHandler<
  BookingDef,
  "BookingCancelled"
> = (_event, state) => ({
  ...state,
  status: "cancelled" as const,
});
