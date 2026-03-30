import type { InferApplyHandler } from "@noddde/core";
import type { BookingDef } from "../booking";

export const applyBookingCreated: InferApplyHandler<
  BookingDef,
  "BookingCreated"
> = (event) => ({
  guestId: event.guestId,
  roomType: event.roomType,
  checkIn: event.checkIn,
  checkOut: event.checkOut,
  totalAmount: event.totalAmount,
  status: "pending" as const,
  roomId: null,
  paymentId: null,
  transactionId: null,
});
