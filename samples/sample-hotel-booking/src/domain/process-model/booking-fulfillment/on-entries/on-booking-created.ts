import { randomUUID } from "crypto";
import type { InferSagaOnEntry } from "@noddde/core";
import type { BookingFulfillmentDef } from "../saga";

export const onBookingCreated: InferSagaOnEntry<
  BookingFulfillmentDef,
  "BookingCreated"
> = {
  id: (event) => event.payload.bookingId,
  handle: (event) => {
    const paymentId = randomUUID();
    return {
      state: {
        bookingId: event.payload.bookingId,
        guestId: event.payload.guestId,
        roomType: event.payload.roomType,
        checkIn: event.payload.checkIn,
        checkOut: event.payload.checkOut,
        totalAmount: event.payload.totalAmount,
        paymentId,
        roomId: null,
        status: "awaiting_payment" as const,
      },
      commands: {
        name: "RequestPayment",
        targetAggregateId: event.payload.bookingId,
        payload: {
          paymentId,
          amount: event.payload.totalAmount,
        },
      },
    };
  },
};
