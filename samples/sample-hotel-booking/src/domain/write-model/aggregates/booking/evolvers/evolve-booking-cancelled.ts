import type { InferEvolveHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const evolveBookingCancelled: InferEvolveHandler<
  BookingDef,
  "BookingCancelled"
> = (_event, state) => ({
  ...state,
  status: "cancelled" as const,
});
