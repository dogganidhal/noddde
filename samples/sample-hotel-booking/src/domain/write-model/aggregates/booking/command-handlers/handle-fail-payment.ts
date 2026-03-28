import type { FailPaymentPayload } from "../commands/fail-payment";
import type { BookingState } from "../state";
import type { BookingEvent } from "../../../../event-model";

/** Handles the FailPayment command by emitting a PaymentFailed event. */
export const handleFailPayment = (
  command: { targetAggregateId: string; payload: FailPaymentPayload },
  state: BookingState,
): BookingEvent => {
  if (state.status !== "awaiting_payment") {
    throw new Error(`Cannot fail payment in ${state.status} status`);
  }
  return {
    name: "PaymentFailed",
    payload: {
      bookingId: command.targetAggregateId,
      paymentId: command.payload.paymentId,
      reason: command.payload.reason,
    },
  };
};
