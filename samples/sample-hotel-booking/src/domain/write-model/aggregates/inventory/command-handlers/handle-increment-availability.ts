import type { IncrementAvailabilityPayload } from "../commands/increment-availability";
import type { InventoryState } from "../state";
import type { InventoryEvent } from "../../../../event-model";

/** Handles the IncrementAvailability command by emitting an AvailabilityIncremented event. */
export const handleIncrementAvailability = (
  command: { targetAggregateId: string; payload: IncrementAvailabilityPayload },
  state: InventoryState,
): InventoryEvent => {
  if (!state.initialized) {
    throw new Error("Inventory not initialized");
  }
  const current = state.roomCounts[command.payload.roomType];
  if (!current) {
    throw new Error(`Unknown room type: ${command.payload.roomType}`);
  }
  return {
    name: "AvailabilityIncremented",
    payload: {
      inventoryId: command.targetAggregateId,
      roomType: command.payload.roomType,
      newAvailable: current.available + 1,
    },
  };
};
