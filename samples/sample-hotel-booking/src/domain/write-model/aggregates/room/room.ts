import { defineAggregate } from "@noddde/core";
import type { HotelInfrastructure } from "../../../../infrastructure/types";
import type { RoomEvent } from "../../../event-model";
import type { RoomCommand } from "./commands";
import type { RoomState } from "./state";
import { initialRoomState } from "./state";
import { handleCreateRoom } from "./command-handlers/handle-create-room";
import { handleMakeRoomAvailable } from "./command-handlers/handle-make-room-available";
import { handleReserveRoom } from "./command-handlers/handle-reserve-room";
import { handleCheckInGuest } from "./command-handlers/handle-check-in-guest";
import { handleCheckOutGuest } from "./command-handlers/handle-check-out-guest";
import { handlePutUnderMaintenance } from "./command-handlers/handle-put-under-maintenance";
import {
  applyRoomCreated,
  applyRoomMadeAvailable,
  applyRoomReserved,
  applyGuestCheckedIn,
  applyGuestCheckedOut,
  applyRoomUnderMaintenance,
} from "./apply-handlers";

/** Type bundle for the Room aggregate. */
export type RoomDef = {
  state: RoomState;
  events: RoomEvent;
  commands: RoomCommand;
  infrastructure: HotelInfrastructure;
};

/**
 * Room aggregate definition.
 *
 * Models a hotel room lifecycle: creation, availability, reservation,
 * occupancy, and maintenance. All handlers are extracted to
 * separate files for maintainability.
 */
export const Room = defineAggregate<RoomDef>({
  initialState: initialRoomState,

  commands: {
    CreateRoom: handleCreateRoom,
    MakeRoomAvailable: handleMakeRoomAvailable,
    ReserveRoom: handleReserveRoom,
    CheckInGuest: handleCheckInGuest,
    CheckOutGuest: handleCheckOutGuest,
    PutUnderMaintenance: handlePutUnderMaintenance,
  },

  apply: {
    RoomCreated: applyRoomCreated,
    RoomMadeAvailable: applyRoomMadeAvailable,
    RoomReserved: applyRoomReserved,
    GuestCheckedIn: applyGuestCheckedIn,
    GuestCheckedOut: applyGuestCheckedOut,
    RoomUnderMaintenance: applyRoomUnderMaintenance,
  },
});
