import type { RoomType } from "../../../../../infrastructure/types";

/** Payload for incrementing room availability. */
export interface IncrementAvailabilityPayload {
  roomType: RoomType;
}
