import type { InferDecideHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

/** Decides the IncrementAvailability command by emitting an AvailabilityIncremented event. */
export const decideIncrementAvailability: InferDecideHandler<
  InventoryDef,
  "IncrementAvailability"
> = (command, state) => {
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
