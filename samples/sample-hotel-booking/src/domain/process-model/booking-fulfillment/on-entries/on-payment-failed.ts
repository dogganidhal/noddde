import type { InferSagaOnEntry } from "@noddde/core";
import type { BookingFulfillmentDef } from "../saga";

export const onPaymentFailed: InferSagaOnEntry<
  BookingFulfillmentDef,
  "PaymentFailed"
> = {
  id: (event) => event.payload.bookingId,
  handle: (event, state) => ({
    state: { ...state, status: "cancelled" as const },
    commands: {
      name: "CancelBooking",
      targetAggregateId: state.bookingId,
      payload: { reason: `Payment failed: ${event.payload.reason}` },
    },
  }),
};
