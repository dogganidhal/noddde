/** Payload for when a payment is requested. */
export interface PaymentRequestedPayload {
  bookingId: string;
  guestId: string;
  paymentId: string;
  amount: number;
}
