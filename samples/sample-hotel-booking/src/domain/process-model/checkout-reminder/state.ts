/** Checkout reminder saga lifecycle status. */
export type CheckoutReminderStatus = "idle" | "guest_checked_in" | "completed";

/** Checkout reminder saga state. */
export interface CheckoutReminderState {
  roomId: string;
  bookingId: string;
  guestId: string;
  status: CheckoutReminderStatus;
}

/** Initial state for the checkout reminder saga. */
export const initialCheckoutReminderState: CheckoutReminderState = {
  roomId: "",
  bookingId: "",
  guestId: "",
  status: "idle",
};
