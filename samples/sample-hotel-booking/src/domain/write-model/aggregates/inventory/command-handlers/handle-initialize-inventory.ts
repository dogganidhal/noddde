import type { InitializeInventoryPayload } from "../commands/initialize-inventory";
import type { InventoryState } from "../state";
import type { InventoryEvent } from "../../../../event-model";

/** Handles the InitializeInventory command by emitting an InventoryInitialized event. */
export const handleInitializeInventory = (
  command: { targetAggregateId: string; payload: InitializeInventoryPayload },
  state: InventoryState,
): InventoryEvent => {
  if (state.initialized) {
    throw new Error("Inventory already initialized");
  }
  return {
    name: "InventoryInitialized",
    payload: {
      inventoryId: command.targetAggregateId,
      roomCounts: command.payload.roomCounts,
    },
  };
};
