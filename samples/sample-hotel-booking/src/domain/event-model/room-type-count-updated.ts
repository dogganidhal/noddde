import type { RoomType } from "../../infrastructure/types";

/** Payload for when a room type count is updated. */
export interface RoomTypeCountUpdatedPayload {
  inventoryId: string;
  roomType: RoomType;
  total: number;
  available: number;
}
