import type { RoomType } from "../../infrastructure/types";

/** Payload for when a booking is created. */
export interface BookingCreatedPayload {
  bookingId: string;
  guestId: string;
  roomType: RoomType;
  checkIn: string;
  checkOut: string;
  totalAmount: number;
  createdAt: string;
}
