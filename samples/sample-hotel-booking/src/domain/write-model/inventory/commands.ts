import { DefineCommands } from "@noddde/core";
import type { RoomType } from "../../../infrastructure/types";

export type InventoryCommand = DefineCommands<{
  InitializeInventory: {
    roomCounts: Record<RoomType, { total: number; available: number }>;
  };
  UpdateRoomTypeCount: {
    roomType: RoomType;
    total: number;
    available: number;
  };
  DecrementAvailability: {
    roomType: RoomType;
  };
  IncrementAvailability: {
    roomType: RoomType;
  };
}>;
