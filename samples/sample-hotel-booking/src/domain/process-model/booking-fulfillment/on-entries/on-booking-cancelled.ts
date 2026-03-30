import type { InferSagaOnEntry } from "@noddde/core";
import type { BookingFulfillmentDef } from "../saga";

export const onBookingCancelled: InferSagaOnEntry<
  BookingFulfillmentDef,
  "BookingCancelled"
> = {
  id: (event) => event.payload.bookingId,
  handle: (_event, state) => ({
    state: { ...state, status: "cancelled" as const },
    commands:
      state.status === "confirmed" && state.paymentId
        ? {
            name: "RefundPayment" as const,
            targetAggregateId: state.bookingId,
            payload: {
              paymentId: state.paymentId,
              amount: state.totalAmount,
            },
          }
        : undefined,
  }),
};
