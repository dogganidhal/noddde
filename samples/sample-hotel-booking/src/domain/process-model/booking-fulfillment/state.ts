import type { RoomType } from "../../../infrastructure/types";

/** Booking fulfillment saga lifecycle status. */
export type BookingFulfillmentStatus =
  | "idle"
  | "awaiting_payment"
  | "confirmed"
  | "cancelled";

/** Booking fulfillment saga state. */
export interface BookingFulfillmentState {
  bookingId: string;
  guestId: string;
  roomType: RoomType | null;
  checkIn: string;
  checkOut: string;
  totalAmount: number;
  paymentId: string | null;
  roomId: string | null;
  status: BookingFulfillmentStatus;
}

/** Initial state for the booking fulfillment saga. */
export const initialBookingFulfillmentState: BookingFulfillmentState = {
  bookingId: "",
  guestId: "",
  roomType: null,
  checkIn: "",
  checkOut: "",
  totalAmount: 0,
  paymentId: null,
  roomId: null,
  status: "idle",
};
