import type { CheckoutReminderState } from "../state";

/** Transition handler for RoomUnderMaintenance: observed, no action needed. */
export const onRoomUnderMaintenance = (
  _event: {
    payload: { roomId: string; reason: string; estimatedUntil: string };
  },
  state: CheckoutReminderState,
) => ({ state });
