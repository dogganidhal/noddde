/** Payload for when a booking is modified. */
export interface BookingModifiedPayload {
  bookingId: string;
  newCheckIn: string;
  newCheckOut: string;
  newTotalAmount: number;
  modifiedAt: string;
}
