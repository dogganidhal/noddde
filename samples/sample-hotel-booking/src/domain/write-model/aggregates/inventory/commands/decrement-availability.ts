import type { RoomType } from "../../../../../infrastructure/types";

/** Payload for decrementing room availability. */
export interface DecrementAvailabilityPayload {
  roomType: RoomType;
}
