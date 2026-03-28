import type { RequestPaymentPayload } from "../commands/request-payment";
import type { BookingState } from "../state";
import type { BookingEvent } from "../../../../event-model";

/** Handles the RequestPayment command by emitting a PaymentRequested event. */
export const handleRequestPayment = (
  command: { targetAggregateId: string; payload: RequestPaymentPayload },
  state: BookingState,
): BookingEvent => {
  if (state.status !== "pending") {
    throw new Error(`Cannot request payment in ${state.status} status`);
  }
  return {
    name: "PaymentRequested",
    payload: {
      bookingId: command.targetAggregateId,
      guestId: state.guestId!,
      paymentId: command.payload.paymentId,
      amount: command.payload.amount,
    },
  };
};
