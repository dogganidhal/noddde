import type { InferDecideHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

/** Decides the UpdateRoomTypeCount command by emitting a RoomTypeCountUpdated event. */
export const decideUpdateRoomTypeCount: InferDecideHandler<
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
