import type { RoomType } from "../../../../../infrastructure/types";
import type { RoomAvailabilityView } from "../room-availability";

/** Payload for listing available rooms. */
export interface ListAvailableRoomsPayload {
  type?: RoomType;
}

/** Result type for ListAvailableRooms query. */
export type ListAvailableRoomsResult = RoomAvailabilityView[];
