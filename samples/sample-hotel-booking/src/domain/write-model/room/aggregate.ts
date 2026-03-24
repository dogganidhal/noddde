import { defineAggregate } from "@noddde/core";
import type { RoomType } from "../../../infrastructure/types";
import type { HotelInfrastructure } from "../../../infrastructure/types";
import type { RoomCommand } from "./commands";
import type { RoomEvent } from "./events";

export type RoomStatus =
  | "created"
  | "available"
  | "reserved"
  | "occupied"
  | "maintenance";

export interface RoomState {
  roomNumber: string | null;
  type: RoomType | null;
  floor: number;
  pricePerNight: number;
  status: RoomStatus;
  currentBookingId: string | null;
  currentGuestId: string | null;
}

type RoomDef = {
  state: RoomState;
  events: RoomEvent;
  commands: RoomCommand;
  infrastructure: HotelInfrastructure;
};

export const Room = defineAggregate<RoomDef>({
  initialState: {
    roomNumber: null,
    type: null,
    floor: 0,
    pricePerNight: 0,
    status: "created",
    currentBookingId: null,
    currentGuestId: null,
  },

  commands: {
    CreateRoom: (command, state) => {
      if (state.roomNumber !== null) {
        throw new Error("Room already created");
      }
      return {
        name: "RoomCreated",
        payload: {
          roomId: command.targetAggregateId,
          roomNumber: command.payload.roomNumber,
          type: command.payload.type,
          floor: command.payload.floor,
          pricePerNight: command.payload.pricePerNight,
        },
      };
    },

    MakeRoomAvailable: (command, state) => {
      if (state.status === "occupied") {
        throw new Error("Cannot make occupied room available");
      }
      return {
        name: "RoomMadeAvailable",
        payload: { roomId: command.targetAggregateId },
      };
    },

    ReserveRoom: (command, state) => {
      if (state.status !== "available") {
        throw new Error(`Cannot reserve room in ${state.status} status`);
      }
      return {
        name: "RoomReserved",
        payload: {
          roomId: command.targetAggregateId,
          bookingId: command.payload.bookingId,
          guestId: command.payload.guestId,
          checkIn: command.payload.checkIn,
          checkOut: command.payload.checkOut,
        },
      };
    },

    CheckInGuest: (command, state, { clock }) => {
      if (state.status !== "reserved") {
        throw new Error(`Cannot check in to room in ${state.status} status`);
      }
      if (state.currentBookingId !== command.payload.bookingId) {
        throw new Error("Booking ID does not match reservation");
      }
      return {
        name: "GuestCheckedIn",
        payload: {
          roomId: command.targetAggregateId,
          bookingId: command.payload.bookingId,
          guestId: command.payload.guestId,
          checkedInAt: clock.now().toISOString(),
        },
      };
    },

    CheckOutGuest: (command, state, { clock }) => {
      if (state.status !== "occupied") {
        throw new Error(`Cannot check out from room in ${state.status} status`);
      }
      return {
        name: "GuestCheckedOut",
        payload: {
          roomId: command.targetAggregateId,
          bookingId: command.payload.bookingId,
          guestId: command.payload.guestId,
          checkedOutAt: clock.now().toISOString(),
        },
      };
    },

    PutUnderMaintenance: (command, state) => {
      if (state.status === "occupied") {
        throw new Error("Cannot put occupied room under maintenance");
      }
      return {
        name: "RoomUnderMaintenance",
        payload: {
          roomId: command.targetAggregateId,
          reason: command.payload.reason,
          estimatedUntil: command.payload.estimatedUntil,
        },
      };
    },
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
