/** Payload for when a booking is confirmed. */
export interface BookingConfirmedPayload {
  bookingId: string;
  roomId: string;
  confirmedAt: string;
}
