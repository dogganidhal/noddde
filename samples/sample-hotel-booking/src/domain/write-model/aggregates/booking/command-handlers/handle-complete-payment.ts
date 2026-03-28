import type { CompletePaymentPayload } from "../commands/complete-payment";
import type { BookingState } from "../state";
import type { HotelInfrastructure } from "../../../../../infrastructure/types";
import type { BookingEvent } from "../../../../event-model";

/** Handles the CompletePayment command by emitting a PaymentCompleted event. */
export const handleCompletePayment = (
  command: { targetAggregateId: string; payload: CompletePaymentPayload },
  state: BookingState,
  { clock }: HotelInfrastructure,
): BookingEvent => {
  if (state.status !== "awaiting_payment") {
    throw new Error(`Cannot complete payment in ${state.status} status`);
  }
  return {
    name: "PaymentCompleted",
    payload: {
      bookingId: command.targetAggregateId,
      paymentId: command.payload.paymentId,
      transactionId: command.payload.transactionId,
      amount: command.payload.amount,
      completedAt: clock.now().toISOString(),
    },
  };
};
