import { defineAggregate } from "@noddde/core";
import type {
  RoomType,
  HotelInfrastructure,
} from "../../../infrastructure/types";
import type { InventoryCommand } from "./commands";
import type { InventoryEvent } from "./events";

export interface InventoryState {
  initialized: boolean;
  roomCounts: Record<RoomType, { total: number; available: number }>;
}

type InventoryDef = {
  state: InventoryState;
  events: InventoryEvent;
  commands: InventoryCommand;
  infrastructure: HotelInfrastructure;
};

const defaultRoomCounts: Record<
  RoomType,
  { total: number; available: number }
> = {
  single: { total: 0, available: 0 },
  double: { total: 0, available: 0 },
  suite: { total: 0, available: 0 },
};

export const Inventory = defineAggregate<InventoryDef>({
  initialState: {
    initialized: false,
    roomCounts: { ...defaultRoomCounts },
  },

  commands: {
    InitializeInventory: (command, state) => {
      if (state.initialized) {
        throw new Error("Inventory already initialized");
      }
      return {
        name: "InventoryInitialized",
        payload: {
          inventoryId: command.targetAggregateId,
          roomCounts: command.payload.roomCounts,
        },
      };
    },

    UpdateRoomTypeCount: (command, state) => {
      if (!state.initialized) {
        throw new Error("Inventory not initialized");
      }
      return {
        name: "RoomTypeCountUpdated",
        payload: {
          inventoryId: command.targetAggregateId,
          roomType: command.payload.roomType,
          total: command.payload.total,
          available: command.payload.available,
        },
      };
    },

    DecrementAvailability: (command, state) => {
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
    },

    IncrementAvailability: (command, state) => {
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
    },
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
