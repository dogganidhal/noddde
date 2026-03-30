import { defineAggregate } from "@noddde/core";
import type { HotelInfrastructure } from "../../../../infrastructure/types";
import type { RoomEvent } from "../../../event-model";
import type { RoomCommand } from "./commands";
import type { RoomState } from "./state";
import { initialRoomState } from "./state";
import { decideCreateRoom } from "./deciders/decide-create-room";
import { decideMakeRoomAvailable } from "./deciders/decide-make-room-available";
import { decideReserveRoom } from "./deciders/decide-reserve-room";
import { decideCheckInGuest } from "./deciders/decide-check-in-guest";
import { decideCheckOutGuest } from "./deciders/decide-check-out-guest";
import { decidePutUnderMaintenance } from "./deciders/decide-put-under-maintenance";
import {
  evolveRoomCreated,
  evolveRoomMadeAvailable,
  evolveRoomReserved,
  evolveGuestCheckedIn,
  evolveGuestCheckedOut,
  evolveRoomUnderMaintenance,
} from "./evolvers";

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

  decide: {
    CreateRoom: decideCreateRoom,
    MakeRoomAvailable: decideMakeRoomAvailable,
    ReserveRoom: decideReserveRoom,
    CheckInGuest: decideCheckInGuest,
    CheckOutGuest: decideCheckOutGuest,
    PutUnderMaintenance: decidePutUnderMaintenance,
  },

  evolve: {
    RoomCreated: evolveRoomCreated,
    RoomMadeAvailable: evolveRoomMadeAvailable,
    RoomReserved: evolveRoomReserved,
    GuestCheckedIn: evolveGuestCheckedIn,
    GuestCheckedOut: evolveGuestCheckedOut,
    RoomUnderMaintenance: evolveRoomUnderMaintenance,
  },
});
