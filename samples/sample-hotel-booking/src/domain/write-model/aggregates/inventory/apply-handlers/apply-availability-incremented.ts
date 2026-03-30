import type { InferApplyHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

export const applyAvailabilityIncremented: InferApplyHandler<
  InventoryDef,
  "AvailabilityIncremented"
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
