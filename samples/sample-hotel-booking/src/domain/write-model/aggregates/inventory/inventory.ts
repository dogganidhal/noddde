import { defineAggregate } from "@noddde/core";
import type { HotelPorts } from "../../../../infrastructure/types";
import type { InventoryEvent } from "../../../event-model";
import type { InventoryCommand } from "./commands";
import type { InventoryState } from "./state";
import { initialInventoryState } from "./state";
import { decideInitializeInventory } from "./deciders/decide-initialize-inventory";
import { decideUpdateRoomTypeCount } from "./deciders/decide-update-room-type-count";
import { decideDecrementAvailability } from "./deciders/decide-decrement-availability";
import { decideIncrementAvailability } from "./deciders/decide-increment-availability";
import {
  evolveInventoryInitialized,
  evolveRoomTypeCountUpdated,
  evolveAvailabilityDecremented,
  evolveAvailabilityIncremented,
} from "./evolvers";

/** Type bundle for the Inventory aggregate. */
export type InventoryDef = {
  state: InventoryState;
  events: InventoryEvent;
  commands: InventoryCommand;
  ports: HotelPorts;
};

/**
 * Inventory aggregate definition.
 *
 * Tracks room counts and availability by room type. Command handlers
 * and apply handlers are extracted into separate files.
 */
export const Inventory = defineAggregate<InventoryDef>({
  initialState: initialInventoryState,

  decide: {
    InitializeInventory: decideInitializeInventory,
    UpdateRoomTypeCount: decideUpdateRoomTypeCount,
    DecrementAvailability: decideDecrementAvailability,
    IncrementAvailability: decideIncrementAvailability,
  },

  evolve: {
    InventoryInitialized: evolveInventoryInitialized,
    RoomTypeCountUpdated: evolveRoomTypeCountUpdated,
    AvailabilityDecremented: evolveAvailabilityDecremented,
    AvailabilityIncremented: evolveAvailabilityIncremented,
  },
});
