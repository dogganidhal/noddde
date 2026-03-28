import type { CheckoutReminderState } from "../state";

/** Transition handler for RoomReserved: observed, no action needed. */
export const onRoomReserved = (
  _event: {
    payload: {
      roomId: string;
      bookingId: string;
      guestId: string;
      checkIn: string;
      checkOut: string;
    };
  },
  state: CheckoutReminderState,
) => ({ state });
