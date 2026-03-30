import type { InferSagaOnEntry } from "@noddde/core";
import type { CheckoutReminderDef } from "../saga";

export const onGuestCheckedIn: InferSagaOnEntry<
  CheckoutReminderDef,
  "GuestCheckedIn"
> = {
  id: (event) => event.payload.roomId,
  handle: async (event, state, { smsService }) => {
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
  },
};
