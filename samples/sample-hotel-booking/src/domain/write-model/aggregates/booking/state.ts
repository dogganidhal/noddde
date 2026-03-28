import type { RoomType } from "../../../../infrastructure/types";

/** Booking lifecycle status. */
export type BookingStatus =
  | "pending"
  | "awaiting_payment"
  | "confirmed"
  | "cancelled"
  | "modified";

/** Booking aggregate state. */
export interface BookingState {
  guestId: string | null;
  roomType: RoomType | null;
  checkIn: string | null;
  checkOut: string | null;
  totalAmount: number;
  status: BookingStatus;
  roomId: string | null;
  paymentId: string | null;
  transactionId: string | null;
}

/** Initial state for a new booking aggregate. */
export const initialBookingState: BookingState = {
  guestId: null,
  roomType: null,
  checkIn: null,
  checkOut: null,
  totalAmount: 0,
  status: "pending",
  roomId: null,
  paymentId: null,
  transactionId: null,
};
