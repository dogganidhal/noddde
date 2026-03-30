import type { InferProjectionQueryHandler } from "@noddde/core";
import type { GuestHistoryProjectionDef } from "../guest-history";

/** Handles the GetGuestHistory query by loading the view from the store. */
export const handleGetGuestHistory: InferProjectionQueryHandler<
  GuestHistoryProjectionDef,
  "GetGuestHistory"
> = async (query, { views }) => (await views.load(query.guestId)) ?? null;
