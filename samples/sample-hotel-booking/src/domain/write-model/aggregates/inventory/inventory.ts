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
import {
  applyInventoryInitialized,
  applyRoomTypeCountUpdated,
  applyAvailabilityDecremented,
  applyAvailabilityIncremented,
} from "./apply-handlers";

/** Type bundle for the Inventory aggregate. */
export type InventoryDef = {
  state: InventoryState;
  events: InventoryEvent;
  commands: InventoryCommand;
  infrastructure: HotelInfrastructure;
};

/**
 * Inventory aggregate definition.
 *
 * Tracks room counts and availability by room type. Command handlers
 * and apply handlers are extracted into separate files.
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
    InventoryInitialized: applyInventoryInitialized,
    RoomTypeCountUpdated: applyRoomTypeCountUpdated,
    AvailabilityDecremented: applyAvailabilityDecremented,
    AvailabilityIncremented: applyAvailabilityIncremented,
  },
});
