import type { CheckoutReminderState } from "../state";

/** Transition handler for GuestCheckedOut: sends farewell SMS and completes saga. */
export const onGuestCheckedOut = async (
  _event: {
    payload: {
      roomId: string;
      bookingId: string;
      guestId: string;
      checkedOutAt: string;
    };
  },
  state: CheckoutReminderState,
  {
    smsService,
  }: { smsService: { send(phone: string, message: string): Promise<void> } },
) => {
  await smsService.send(
    state.guestId,
    `Thank you for your stay! We hope to see you again.`,
  );
  return {
    state: {
      ...state,
      status: "completed" as const,
    },
  };
};
