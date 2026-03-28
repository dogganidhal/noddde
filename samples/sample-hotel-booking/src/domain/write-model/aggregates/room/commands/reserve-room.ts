/** Payload for reserving a room. */
export interface ReserveRoomPayload {
  bookingId: string;
  guestId: string;
  checkIn: string;
  checkOut: string;
}
