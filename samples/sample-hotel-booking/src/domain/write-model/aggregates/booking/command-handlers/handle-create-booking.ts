import type { CreateBookingPayload } from "../commands/create-booking";
import type { BookingState } from "../state";
import type { HotelInfrastructure } from "../../../../../infrastructure/types";
import type { BookingEvent } from "../../../../event-model";

/** Handles the CreateBooking command by emitting a BookingCreated event. */
export const handleCreateBooking = (
  command: { targetAggregateId: string; payload: CreateBookingPayload },
  state: BookingState,
  { clock }: HotelInfrastructure,
): BookingEvent => {
  if (state.guestId !== null) {
    throw new Error("Booking already created");
  }
  return {
    name: "BookingCreated",
    payload: {
      bookingId: command.targetAggregateId,
      guestId: command.payload.guestId,
      roomType: command.payload.roomType,
      checkIn: command.payload.checkIn,
      checkOut: command.payload.checkOut,
      totalAmount: command.payload.totalAmount,
      createdAt: clock.now().toISOString(),
    },
  };
};
