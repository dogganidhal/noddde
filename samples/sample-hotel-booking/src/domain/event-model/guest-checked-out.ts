/** Payload for when a guest checks out. */
export interface GuestCheckedOutPayload {
  roomId: string;
  bookingId: string;
  guestId: string;
  checkedOutAt: string;
}
