import type { RoomType } from "../../infrastructure/types";

/** Payload for when a room is created. */
export interface RoomCreatedPayload {
  roomId: string;
  roomNumber: string;
  type: RoomType;
  floor: number;
  pricePerNight: number;
}
