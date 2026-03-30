import type { InferEvolveHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const evolveBookingConfirmed: InferEvolveHandler<
  BookingDef,
  "BookingConfirmed"
> = (event, state) => ({
  ...state,
  status: "confirmed" as const,
  roomId: event.roomId,
});
