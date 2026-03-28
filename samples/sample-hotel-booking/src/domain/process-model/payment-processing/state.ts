/** Payment processing saga lifecycle status. */
export type PaymentProcessingStatus =
  | "idle"
  | "charging"
  | "completed"
  | "failed";

/** Payment processing saga state. */
export interface PaymentProcessingState {
  bookingId: string;
  guestId: string;
  paymentId: string;
  amount: number;
  status: PaymentProcessingStatus;
}

/** Initial state for the payment processing saga. */
export const initialPaymentProcessingState: PaymentProcessingState = {
  bookingId: "",
  guestId: "",
  paymentId: "",
  amount: 0,
  status: "idle",
};
