/** Payload for when a payment fails. */
export interface PaymentFailedPayload {
  bookingId: string;
  paymentId: string;
  reason: string;
}
