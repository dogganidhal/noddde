import type { CheckOutGuestPayload } from "../commands/check-out-guest";
import type { RoomState } from "../state";
import type { HotelInfrastructure } from "../../../../../infrastructure/types";
import type { RoomEvent } from "../../../../event-model";

/** Handles the CheckOutGuest command by emitting a GuestCheckedOut event. */
export const handleCheckOutGuest = (
  command: { targetAggregateId: string; payload: CheckOutGuestPayload },
  state: RoomState,
  { clock }: HotelInfrastructure,
): RoomEvent => {
  if (state.status !== "occupied") {
    throw new Error(`Cannot check out from room in ${state.status} status`);
  }
  return {
    name: "GuestCheckedOut",
    payload: {
      roomId: command.targetAggregateId,
      bookingId: command.payload.bookingId,
      guestId: command.payload.guestId,
      checkedOutAt: clock.now().toISOString(),
    },
  };
};
