import type { RoomType } from "../../../../../infrastructure/types";

/** Payload for creating a new room. */
export interface CreateRoomPayload {
  roomNumber: string;
  type: RoomType;
  floor: number;
  pricePerNight: number;
}
