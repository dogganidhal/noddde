import type { RoomType } from "../../../../../infrastructure/types";

/** Payload for initializing the inventory. */
export interface InitializeInventoryPayload {
  roomCounts: Record<RoomType, { total: number; available: number }>;
}
