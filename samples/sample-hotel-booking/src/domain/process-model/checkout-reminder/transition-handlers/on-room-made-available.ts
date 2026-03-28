import type { CheckoutReminderState } from "../state";

/** Transition handler for RoomMadeAvailable: observed, no action needed. */
export const onRoomMadeAvailable = (
  _event: { payload: { roomId: string } },
  state: CheckoutReminderState,
) => ({ state });
