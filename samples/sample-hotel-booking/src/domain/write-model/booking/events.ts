import { DefineEvents } from "@noddde/core";
import type { RoomType } from "../../../infrastructure/types";

export type BookingEvent = DefineEvents<{
  BookingCreated: {
    bookingId: string;
    guestId: string;
    roomType: RoomType;
    checkIn: string;
    checkOut: string;
    totalAmount: number;
    createdAt: string;
  };
  BookingConfirmed: {
    bookingId: string;
    roomId: string;
    confirmedAt: string;
  };
  BookingCancelled: {
    bookingId: string;
    reason: string;
    cancelledAt: string;
  };
  BookingModified: {
    bookingId: string;
    newCheckIn: string;
    newCheckOut: string;
    newTotalAmount: number;
    modifiedAt: string;
  };
  PaymentRequested: {
    bookingId: string;
    guestId: string;
    paymentId: string;
    amount: number;
  };
  PaymentCompleted: {
    bookingId: string;
    paymentId: string;
    transactionId: string;
    amount: number;
    completedAt: string;
  };
  PaymentFailed: {
    bookingId: string;
    paymentId: string;
    reason: string;
  };
  PaymentRefunded: {
    bookingId: string;
    paymentId: string;
    amount: number;
    refundedAt: string;
  };
}>;
