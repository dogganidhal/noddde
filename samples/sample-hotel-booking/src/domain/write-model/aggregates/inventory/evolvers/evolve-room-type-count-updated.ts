import type { InferEvolveHandler } from "@noddde/core";
import type { InventoryDef } from "../inventory";

export const evolveRoomTypeCountUpdated: InferEvolveHandler<
  InventoryDef,
  "RoomTypeCountUpdated"
> = (event, state) => ({
  ...state,
  roomCounts: {
    ...state.roomCounts,
    [event.roomType]: { total: event.total, available: event.available },
  },
});
