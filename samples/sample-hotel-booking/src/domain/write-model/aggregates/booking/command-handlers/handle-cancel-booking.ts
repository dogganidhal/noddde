import type { InferCommandHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Handles the CancelBooking command by emitting a BookingCancelled event. */
export const handleCancelBooking: InferCommandHandler<
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
