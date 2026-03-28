import type { DefineQueries } from "@noddde/core";
import type { RoomType } from "../../infrastructure/types";

// Re-export view types and query types from projection directories
export type { RoomAvailabilityView } from "./projections/room-availability/room-availability";
export type {
  RoomAvailabilityQuery,
  RoomAvailabilityViewStore,
} from "./projections/room-availability/queries";

export type { GuestHistoryView } from "./projections/guest-history/guest-history";
export type { GuestHistoryQuery } from "./projections/guest-history/queries";

export type { RevenueView } from "./projections/revenue/revenue";
export type { RevenueQuery } from "./projections/revenue/queries";

// ── Standalone query types (not part of any projection) ────────

export type SearchQuery = DefineQueries<{
  SearchAvailableRooms: {
    payload: { type?: RoomType };
    result: import("./projections/room-availability/room-availability").RoomAvailabilityView[];
  };
}>;
