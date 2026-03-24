import { DefineEvents } from "@noddde/core";
import type { RoomType } from "../../../infrastructure/types";

export type InventoryEvent = DefineEvents<{
  InventoryInitialized: {
    inventoryId: string;
    roomCounts: Record<RoomType, { total: number; available: number }>;
  };
  RoomTypeCountUpdated: {
    inventoryId: string;
    roomType: RoomType;
    total: number;
    available: number;
  };
  AvailabilityDecremented: {
    inventoryId: string;
    roomType: RoomType;
    newAvailable: number;
  };
  AvailabilityIncremented: {
    inventoryId: string;
    roomType: RoomType;
    newAvailable: number;
  };
}>;
