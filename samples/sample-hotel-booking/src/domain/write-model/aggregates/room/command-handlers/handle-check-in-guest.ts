import type { CheckInGuestPayload } from "../commands/check-in-guest";
import type { RoomState } from "../state";
import type { HotelInfrastructure } from "../../../../../infrastructure/types";
import type { RoomEvent } from "../../../../event-model";

/** Handles the CheckInGuest command by emitting a GuestCheckedIn event. */
export const handleCheckInGuest = (
  command: { targetAggregateId: string; payload: CheckInGuestPayload },
  state: RoomState,
  { clock }: HotelInfrastructure,
): RoomEvent => {
  if (state.status !== "reserved") {
    throw new Error(`Cannot check in to room in ${state.status} status`);
  }
  if (state.currentBookingId !== command.payload.bookingId) {
    throw new Error("Booking ID does not match reservation");
  }
  return {
    name: "GuestCheckedIn",
    payload: {
      roomId: command.targetAggregateId,
      bookingId: command.payload.bookingId,
      guestId: command.payload.guestId,
      checkedInAt: clock.now().toISOString(),
    },
  };
};
