import { defineProjection } from "@noddde/core";
import type { HotelPorts } from "../../../../infrastructure/types";
import type { RoomType } from "../../../../infrastructure/types";
import type { RoomEvent } from "../../../event-model";
import type {
  RoomAvailabilityQuery,
  RoomAvailabilityViewStore,
} from "./queries";
import {
  onRoomCreated,
  onRoomMadeAvailable,
  onRoomReserved,
  onGuestCheckedIn,
  onGuestCheckedOut,
  onRoomUnderMaintenance,
} from "./on-entries";
import {
  handleGetRoomAvailability,
  handleListAvailableRooms,
} from "./query-handlers";

/** View for room availability. */
export interface RoomAvailabilityView {
  roomId: string;
  roomNumber: string;
  type: RoomType;
  floor: number;
  pricePerNight: number;
  status: string;
  currentGuestId: string | null;
}

/** Type bundle for the RoomAvailability projection. */
export type RoomAvailabilityProjectionDef = {
  events: RoomEvent;
  queries: RoomAvailabilityQuery;
  view: RoomAvailabilityView;
  ports: HotelPorts;
  viewStore: RoomAvailabilityViewStore;
};

/**
 * Room availability projection definition.
 *
 * Maintains a denormalized view of each room's current availability
 * status. Supports querying by room ID and listing available rooms.
 */
export const RoomAvailabilityProjection =
  defineProjection<RoomAvailabilityProjectionDef>({
    consistency: "strong",

    initialView: {
      roomId: "",
      roomNumber: "",
      type: "single",
      floor: 0,
      pricePerNight: 0,
      status: "created",
      currentGuestId: null,
    },

    on: {
      RoomCreated: onRoomCreated,
      RoomMadeAvailable: onRoomMadeAvailable,
      RoomReserved: onRoomReserved,
      GuestCheckedIn: onGuestCheckedIn,
      GuestCheckedOut: onGuestCheckedOut,
      RoomUnderMaintenance: onRoomUnderMaintenance,
    },

    queryHandlers: {
      GetRoomAvailability: handleGetRoomAvailability,
      ListAvailableRooms: handleListAvailableRooms,
    },
  });
