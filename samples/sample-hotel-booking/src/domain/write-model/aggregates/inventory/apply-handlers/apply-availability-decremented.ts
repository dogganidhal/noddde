import type { InferApplyHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

export const applyAvailabilityDecremented: InferApplyHandler<
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
