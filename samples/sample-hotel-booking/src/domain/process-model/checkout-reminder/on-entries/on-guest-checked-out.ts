import type { InferSagaOnEntry } from "@noddde/core";
import type { CheckoutReminderDef } from "../saga";

export const onGuestCheckedOut: InferSagaOnEntry<
  CheckoutReminderDef,
  "GuestCheckedOut"
> = {
  id: (event) => event.payload.roomId,
  handle: async (event, state, { smsService }) => {
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
  },
};
