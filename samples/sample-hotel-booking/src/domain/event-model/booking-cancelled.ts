/** Payload for when a booking is cancelled. */
export interface BookingCancelledPayload {
  bookingId: string;
  reason: string;
  cancelledAt: string;
}
