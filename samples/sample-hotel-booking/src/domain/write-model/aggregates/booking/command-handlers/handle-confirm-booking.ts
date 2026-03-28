import type { ConfirmBookingPayload } from "../commands/confirm-booking";
import type { BookingState } from "../state";
import type { HotelInfrastructure } from "../../../../../infrastructure/types";
import type { BookingEvent } from "../../../../event-model";

/** Handles the ConfirmBooking command by emitting a BookingConfirmed event. */
export const handleConfirmBooking = (
  command: { targetAggregateId: string; payload: ConfirmBookingPayload },
  state: BookingState,
  { clock }: HotelInfrastructure,
): BookingEvent => {
  if (state.status !== "awaiting_payment" && state.status !== "pending") {
    throw new Error(`Cannot confirm booking in ${state.status} status`);
  }
  return {
    name: "BookingConfirmed",
    payload: {
      bookingId: command.targetAggregateId,
      roomId: command.payload.roomId,
      confirmedAt: clock.now().toISOString(),
    },
  };
};
