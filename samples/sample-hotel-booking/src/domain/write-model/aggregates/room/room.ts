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

/** Type bundle for the Room aggregate. */
type RoomDef = {
  state: RoomState;
  events: RoomEvent;
  commands: RoomCommand;
  infrastructure: HotelInfrastructure;
};

/**
 * Room aggregate definition.
 *
 * Models a hotel room lifecycle: creation, availability, reservation,
 * occupancy, and maintenance. Command handlers are extracted; apply
 * handlers remain inline.
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
    RoomCreated: (event) => ({
      roomNumber: event.roomNumber,
      type: event.type,
      floor: event.floor,
      pricePerNight: event.pricePerNight,
      status: "created" as const,
      currentBookingId: null,
      currentGuestId: null,
    }),

    RoomMadeAvailable: (_event, state) => ({
      ...state,
      status: "available" as const,
      currentBookingId: null,
      currentGuestId: null,
    }),

    RoomReserved: (event, state) => ({
      ...state,
      status: "reserved" as const,
      currentBookingId: event.bookingId,
      currentGuestId: event.guestId,
    }),

    GuestCheckedIn: (_event, state) => ({
      ...state,
      status: "occupied" as const,
    }),

    GuestCheckedOut: (_event, state) => ({
      ...state,
      status: "available" as const,
      currentBookingId: null,
      currentGuestId: null,
    }),

    RoomUnderMaintenance: (_event, state) => ({
      ...state,
      status: "maintenance" as const,
      currentBookingId: null,
      currentGuestId: null,
    }),
  },
});
