import { randomUUID } from "crypto";
import type { BookingFulfillmentState } from "../state";

/** Transition handler for BookingCreated: initiates payment request. */
export const onBookingCreated = (event: {
  payload: {
    bookingId: string;
    guestId: string;
    roomType: any;
    checkIn: string;
    checkOut: string;
    totalAmount: number;
    createdAt: string;
  };
}) => {
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
    } satisfies BookingFulfillmentState,
    commands: {
      name: "RequestPayment" as const,
      targetAggregateId: event.payload.bookingId,
      payload: {
        paymentId,
        amount: event.payload.totalAmount,
      },
    },
  };
};
