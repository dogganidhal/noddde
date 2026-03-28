import type { RoomType } from "../../infrastructure/types";

/** Payload for when the inventory is initialized. */
export interface InventoryInitializedPayload {
  inventoryId: string;
  roomCounts: Record<RoomType, { total: number; available: number }>;
}
