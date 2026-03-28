import type { CheckoutReminderState } from "../state";

/** Transition handler for RoomCreated: observed, no action needed. */
export const onRoomCreated = (
  _event: {
    payload: {
      roomId: string;
      roomNumber: string;
      type: any;
      floor: number;
      pricePerNight: number;
    };
  },
  state: CheckoutReminderState,
) => ({ state });
