import type { DefineQueries } from "@noddde/core";
import type { ViewStore } from "@noddde/core";
import type { RoomType } from "../../../../../infrastructure/types";
import type { RoomAvailabilityView } from "../room-availability";
import type { GetRoomAvailabilityPayload } from "./get-room-availability";
import type { ListAvailableRoomsPayload } from "./list-available-rooms";

export type { GetRoomAvailabilityPayload } from "./get-room-availability";
export type { ListAvailableRoomsPayload } from "./list-available-rooms";

/**
 * Extended view store for room availability. Adds domain-specific
 * query methods that push filtering to the database instead of
 * loading all views into memory.
 */
export interface RoomAvailabilityViewStore
  extends ViewStore<RoomAvailabilityView> {
  /** Finds available rooms, optionally filtered by room type. */
  // eslint-disable-next-line no-unused-vars
  findAvailable(type?: RoomType): Promise<RoomAvailabilityView[]>;
}

/** Discriminated union of all room availability queries. */
export type RoomAvailabilityQuery = DefineQueries<{
  GetRoomAvailability: {
    payload: GetRoomAvailabilityPayload;
    result: RoomAvailabilityView | null;
  };
  ListAvailableRooms: {
    payload: ListAvailableRoomsPayload;
    result: RoomAvailabilityView[];
  };
}>;
