/** Payload for when a room is reserved. */
export interface RoomReservedPayload {
  roomId: string;
  bookingId: string;
  guestId: string;
  checkIn: string;
  checkOut: string;
}
