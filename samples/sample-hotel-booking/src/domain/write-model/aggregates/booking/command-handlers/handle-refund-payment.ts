import type { RefundPaymentPayload } from "../commands/refund-payment";
import type { BookingState } from "../state";
import type { HotelInfrastructure } from "../../../../../infrastructure/types";
import type { BookingEvent } from "../../../../event-model";

/** Handles the RefundPayment command by emitting a PaymentRefunded event. */
export const handleRefundPayment = (
  command: { targetAggregateId: string; payload: RefundPaymentPayload },
  state: BookingState,
  { clock }: HotelInfrastructure,
): BookingEvent => {
  if (state.transactionId === null) {
    throw new Error("No payment to refund");
  }
  return {
    name: "PaymentRefunded",
    payload: {
      bookingId: command.targetAggregateId,
      paymentId: command.payload.paymentId,
      amount: command.payload.amount,
      refundedAt: clock.now().toISOString(),
    },
  };
};
