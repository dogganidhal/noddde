/** Payload for refunding a payment. */
export interface RefundPaymentPayload {
  paymentId: string;
  amount: number;
}
