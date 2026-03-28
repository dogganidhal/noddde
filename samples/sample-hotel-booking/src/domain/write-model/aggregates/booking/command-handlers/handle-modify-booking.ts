import type { ModifyBookingPayload } from "../commands/modify-booking";
import type { BookingState } from "../state";
import type { HotelInfrastructure } from "../../../../../infrastructure/types";
import type { BookingEvent } from "../../../../event-model";

/** Handles the ModifyBooking command by emitting a BookingModified event. */
export const handleModifyBooking = (
  command: { targetAggregateId: string; payload: ModifyBookingPayload },
  state: BookingState,
  { clock }: HotelInfrastructure,
): BookingEvent => {
  if (state.status === "cancelled") {
    throw new Error("Cannot modify cancelled booking");
  }
  return {
    name: "BookingModified",
    payload: {
      bookingId: command.targetAggregateId,
      newCheckIn: command.payload.newCheckIn,
      newCheckOut: command.payload.newCheckOut,
      newTotalAmount: command.payload.newTotalAmount,
      modifiedAt: clock.now().toISOString(),
    },
  };
};
