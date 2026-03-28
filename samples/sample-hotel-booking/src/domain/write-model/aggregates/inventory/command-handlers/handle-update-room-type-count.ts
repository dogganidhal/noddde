import type { UpdateRoomTypeCountPayload } from "../commands/update-room-type-count";
import type { InventoryState } from "../state";
import type { InventoryEvent } from "../../../../event-model";

/** Handles the UpdateRoomTypeCount command by emitting a RoomTypeCountUpdated event. */
export const handleUpdateRoomTypeCount = (
  command: { targetAggregateId: string; payload: UpdateRoomTypeCountPayload },
  state: InventoryState,
): InventoryEvent => {
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
