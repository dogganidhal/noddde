import type { RoomType } from "../../../../../infrastructure/types";

/** Payload for creating a new booking. */
export interface CreateBookingPayload {
  guestId: string;
  roomType: RoomType;
  checkIn: string;
  checkOut: string;
  totalAmount: number;
}
