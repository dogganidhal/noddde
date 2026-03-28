/** Payload for when a payment is completed. */
export interface PaymentCompletedPayload {
  bookingId: string;
  paymentId: string;
  transactionId: string;
  amount: number;
  completedAt: string;
}
