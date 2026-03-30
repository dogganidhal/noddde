import type { InferCommandHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

/** Handles the UpdateRoomTypeCount command by emitting a RoomTypeCountUpdated event. */
export const handleUpdateRoomTypeCount: InferCommandHandler<
  InventoryDef,
  "UpdateRoomTypeCount"
> = (command, state) => {
  if (!state.initialized) {
    throw new Error("Inventory not initialized");
  }
  return {
    name: "RoomTypeCountUpdated",
    payload: {
      inventoryId: command.targetAggregateId,
      roomType: command.payload.roomType,
      total: command.payload.total,
      available: command.payload.available,
    },
  };
};
