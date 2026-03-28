import type { RoomAvailabilityViewStore } from "../queries";
import type { GetRoomAvailabilityPayload } from "../queries/get-room-availability";
import type { RoomAvailabilityView } from "../room-availability";

/** Handles the GetRoomAvailability query by loading the view from the store. */
export const handleGetRoomAvailability = async (
  query: GetRoomAvailabilityPayload,
  { views }: { views: RoomAvailabilityViewStore },
): Promise<RoomAvailabilityView | null> =>
  (await views.load(query.roomId)) ?? null;
