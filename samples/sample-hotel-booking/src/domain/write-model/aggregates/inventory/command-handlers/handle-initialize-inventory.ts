import type { InferCommandHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

/** Handles the InitializeInventory command by emitting an InventoryInitialized event. */
export const handleInitializeInventory: InferCommandHandler<
  InventoryDef,
  "InitializeInventory"
> = (command, state) => {
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
