import type { RoomAvailabilityView } from "../room-availability";

/** Payload for querying a single room's availability. */
export interface GetRoomAvailabilityPayload {
  roomId: string;
}

/** Result type for GetRoomAvailability query. */
export type GetRoomAvailabilityResult = RoomAvailabilityView | null;
