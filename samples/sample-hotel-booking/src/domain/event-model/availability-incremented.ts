import type { RoomType } from "../../infrastructure/types";

/** Payload for when room availability is incremented. */
export interface AvailabilityIncrementedPayload {
  inventoryId: string;
  roomType: RoomType;
  newAvailable: number;
}
