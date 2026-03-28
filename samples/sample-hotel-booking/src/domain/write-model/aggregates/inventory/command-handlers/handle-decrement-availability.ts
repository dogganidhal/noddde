import type { DecrementAvailabilityPayload } from "../commands/decrement-availability";
import type { InventoryState } from "../state";
import type { InventoryEvent } from "../../../../event-model";

/** Handles the DecrementAvailability command by emitting an AvailabilityDecremented event. */
export const handleDecrementAvailability = (
  command: { targetAggregateId: string; payload: DecrementAvailabilityPayload },
  state: InventoryState,
): InventoryEvent => {
  if (!state.initialized) {
    throw new Error("Inventory not initialized");
  }
  const current = state.roomCounts[command.payload.roomType];
  if (!current || current.available <= 0) {
    throw new Error(`No ${command.payload.roomType} rooms available`);
  }
  return {
    name: "AvailabilityDecremented",
    payload: {
      inventoryId: command.targetAggregateId,
      roomType: command.payload.roomType,
      newAvailable: current.available - 1,
    },
  };
};
