import type { InferEvolveHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

export const evolveAvailabilityDecremented: InferEvolveHandler<
  InventoryDef,
  "AvailabilityDecremented"
> = (event, state) => ({
  ...state,
  roomCounts: {
    ...state.roomCounts,
    [event.roomType]: {
      ...state.roomCounts[event.roomType]!,
      available: event.newAvailable,
    },
  },
});
