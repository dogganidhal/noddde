/** Payload for when a payment is refunded. */
export interface PaymentRefundedPayload {
  bookingId: string;
  paymentId: string;
  amount: number;
  refundedAt: string;
}
