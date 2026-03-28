/** Payload for failing a payment. */
export interface FailPaymentPayload {
  paymentId: string;
  reason: string;
}
