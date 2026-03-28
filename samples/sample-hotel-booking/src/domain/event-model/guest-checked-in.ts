/** Payload for when a guest checks in. */
export interface GuestCheckedInPayload {
  roomId: string;
  bookingId: string;
  guestId: string;
  checkedInAt: string;
}
