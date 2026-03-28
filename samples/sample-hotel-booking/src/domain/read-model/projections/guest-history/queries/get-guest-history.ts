import type { GuestHistoryView } from "../guest-history";

/** Payload for querying a guest's booking history. */
export interface GetGuestHistoryPayload {
  guestId: string;
}

/** Result type for GetGuestHistory query. */
export type GetGuestHistoryResult = GuestHistoryView | null;
