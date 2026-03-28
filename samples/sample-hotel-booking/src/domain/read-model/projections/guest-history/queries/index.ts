import type { DefineQueries } from "@noddde/core";
import type { GuestHistoryView } from "../guest-history";
import type { GetGuestHistoryPayload } from "./get-guest-history";

export type { GetGuestHistoryPayload } from "./get-guest-history";

/** Discriminated union of all guest history queries. */
export type GuestHistoryQuery = DefineQueries<{
  GetGuestHistory: {
    payload: GetGuestHistoryPayload;
    result: GuestHistoryView | null;
  };
}>;
