import type { InferDecideHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

/** Decides the DecrementAvailability command by emitting an AvailabilityDecremented event. */
export const decideDecrementAvailability: InferDecideHandler<
  InventoryDef,
  "DecrementAvailability"
> = (command, state) => {
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
