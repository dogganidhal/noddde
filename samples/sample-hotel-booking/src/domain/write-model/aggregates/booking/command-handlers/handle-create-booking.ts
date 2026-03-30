import type { InferCommandHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

/** Handles the CreateBooking command by emitting a BookingCreated event. */
export const handleCreateBooking: InferCommandHandler<
  BookingDef,
  "CreateBooking"
> = (command, state, { clock }) => {
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
