import type { InferDecideHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Decides the CancelBooking command by emitting a BookingCancelled event. */
export const decideCancelBooking: InferDecideHandler<
  BookingDef,
  "CancelBooking"
> = (command, state, { clock }) => {
  if (state.status === "cancelled") {
    throw new Error("Booking already cancelled");
  }
  return {
    name: "BookingCancelled",
    payload: {
      bookingId: command.targetAggregateId,
      reason: command.payload.reason,
      cancelledAt: clock.now().toISOString(),
    },
  };
};
