import type { RoomAvailabilityViewStore } from "../queries";
import type { ListAvailableRoomsPayload } from "../queries/list-available-rooms";
import type { RoomAvailabilityView } from "../room-availability";

/** Handles the ListAvailableRooms query by finding available rooms in the store. */
export const handleListAvailableRooms = async (
  query: ListAvailableRoomsPayload,
  { views }: { views: RoomAvailabilityViewStore },
): Promise<RoomAvailabilityView[]> => views.findAvailable(query.type);
