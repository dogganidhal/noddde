import type { RoomType } from "../../../../infrastructure/types";

/** Inventory aggregate state. */
export interface InventoryState {
  initialized: boolean;
  roomCounts: Record<RoomType, { total: number; available: number }>;
}

/** Default room counts for inventory initialization. */
export const defaultRoomCounts: Record<
  RoomType,
  { total: number; available: number }
> = {
  single: { total: 0, available: 0 },
  double: { total: 0, available: 0 },
  suite: { total: 0, available: 0 },
};

/** Initial state for a new inventory aggregate. */
export const initialInventoryState: InventoryState = {
  initialized: false,
  roomCounts: { ...defaultRoomCounts },
};
