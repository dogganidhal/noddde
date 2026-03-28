import type { CheckoutReminderState } from "../state";

/** Transition handler for GuestCheckedIn: records stay and sends welcome SMS. */
export const onGuestCheckedIn = async (
  event: {
    payload: {
      roomId: string;
      bookingId: string;
      guestId: string;
      checkedInAt: string;
    };
  },
  state: CheckoutReminderState,
  {
    smsService,
  }: { smsService: { send(phone: string, message: string): Promise<void> } },
) => {
  await smsService.send(
    event.payload.guestId,
    `Welcome! Your checkout is expected at the end of your stay.`,
  );
  return {
    state: {
      ...state,
      roomId: event.payload.roomId,
      bookingId: event.payload.bookingId,
      guestId: event.payload.guestId,
      status: "guest_checked_in" as const,
    },
  };
};
