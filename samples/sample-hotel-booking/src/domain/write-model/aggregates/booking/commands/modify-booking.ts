/** Payload for modifying a booking. */
export interface ModifyBookingPayload {
  newCheckIn: string;
  newCheckOut: string;
  newTotalAmount: number;
}
