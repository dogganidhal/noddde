import type { CancelBookingPayload } from "../commands/cancel-booking";
import type { BookingState } from "../state";
import type { HotelInfrastructure } from "../../../../../infrastructure/types";
import type { BookingEvent } from "../../../../event-model";

/** Handles the CancelBooking command by emitting a BookingCancelled event. */
export const handleCancelBooking = (
  command: { targetAggregateId: string; payload: CancelBookingPayload },
  state: BookingState,
  { clock }: HotelInfrastructure,
): BookingEvent => {
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
