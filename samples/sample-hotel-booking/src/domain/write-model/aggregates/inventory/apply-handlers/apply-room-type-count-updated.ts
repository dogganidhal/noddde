import type { InferApplyHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

export const applyRoomTypeCountUpdated: InferApplyHandler<
  InventoryDef,
  "RoomTypeCountUpdated"
> = (event, state) => ({
  ...state,
  roomCounts: {
    ...state.roomCounts,
    [event.roomType]: { total: event.total, available: event.available },
  },
});
