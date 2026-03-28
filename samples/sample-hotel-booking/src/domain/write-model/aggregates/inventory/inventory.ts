import { defineAggregate } from "@noddde/core";
import type { HotelInfrastructure } from "../../../../infrastructure/types";
import type { InventoryEvent } from "../../../event-model";
import type { InventoryCommand } from "./commands";
import type { InventoryState } from "./state";
import { initialInventoryState } from "./state";
import { handleInitializeInventory } from "./command-handlers/handle-initialize-inventory";
import { handleUpdateRoomTypeCount } from "./command-handlers/handle-update-room-type-count";
import { handleDecrementAvailability } from "./command-handlers/handle-decrement-availability";
import { handleIncrementAvailability } from "./command-handlers/handle-increment-availability";

/** Type bundle for the Inventory aggregate. */
type InventoryDef = {
  state: InventoryState;
  events: InventoryEvent;
  commands: InventoryCommand;
  infrastructure: HotelInfrastructure;
};

/**
 * Inventory aggregate definition.
 *
 * Tracks room counts and availability by room type. Command handlers
 * are extracted; apply handlers remain inline.
 */
export const Inventory = defineAggregate<InventoryDef>({
  initialState: initialInventoryState,

  commands: {
    InitializeInventory: handleInitializeInventory,
    UpdateRoomTypeCount: handleUpdateRoomTypeCount,
    DecrementAvailability: handleDecrementAvailability,
    IncrementAvailability: handleIncrementAvailability,
  },

  apply: {
    InventoryInitialized: (event) => ({
      initialized: true,
      roomCounts: { ...event.roomCounts },
    }),

    RoomTypeCountUpdated: (event, state) => ({
      ...state,
      roomCounts: {
        ...state.roomCounts,
        [event.roomType]: { total: event.total, available: event.available },
      },
    }),

    AvailabilityDecremented: (event, state) => ({
      ...state,
      roomCounts: {
        ...state.roomCounts,
        [event.roomType]: {
          ...state.roomCounts[event.roomType]!,
          available: event.newAvailable,
        },
      },
    }),

    AvailabilityIncremented: (event, state) => ({
      ...state,
      roomCounts: {
        ...state.roomCounts,
        [event.roomType]: {
          ...state.roomCounts[event.roomType]!,
          available: event.newAvailable,
        },
      },
    }),
  },
});
