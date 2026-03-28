import type { RoomType } from "../../../../../infrastructure/types";

/** Payload for updating a room type count. */
export interface UpdateRoomTypeCountPayload {
  roomType: RoomType;
  total: number;
  available: number;
}
