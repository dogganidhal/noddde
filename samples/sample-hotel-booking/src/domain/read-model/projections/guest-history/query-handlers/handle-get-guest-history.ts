import type { ViewStore } from "@noddde/core";
import type { GetGuestHistoryPayload } from "../queries/get-guest-history";
import type { GuestHistoryView } from "../guest-history";

/** Handles the GetGuestHistory query by loading the view from the store. */
export const handleGetGuestHistory = async (
  query: GetGuestHistoryPayload,
  { views }: { views: ViewStore<GuestHistoryView> },
): Promise<GuestHistoryView | null> =>
  (await views.load(query.guestId)) ?? null;
