import type { RoomType } from "../../infrastructure/types";

/** Payload for when room availability is decremented. */
export interface AvailabilityDecrementedPayload {
  inventoryId: string;
  roomType: RoomType;
  newAvailable: number;
}
