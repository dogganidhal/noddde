/** Payload for completing a payment. */
export interface CompletePaymentPayload {
  paymentId: string;
  transactionId: string;
  amount: number;
}
