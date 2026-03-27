import { defineProjection } from "@noddde/core";
import type { HotelInfrastructure } from "../../../infrastructure/types";
import type { RoomEvent } from "../../write-model/room/events";
import type {
  RoomAvailabilityView,
  RoomAvailabilityQuery,
  RoomAvailabilityViewStore,
} from "../queries";

type RoomAvailabilityProjectionDef = {
  events: RoomEvent;
  queries: RoomAvailabilityQuery;
  view: RoomAvailabilityView;
  infrastructure: HotelInfrastructure;
  viewStore: RoomAvailabilityViewStore;
};

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
      RoomCreated: {
        id: (event) => event.payload.roomId,
        reduce: (event) => ({
          roomId: event.payload.roomId,
          roomNumber: event.payload.roomNumber,
          type: event.payload.type,
          floor: event.payload.floor,
          pricePerNight: event.payload.pricePerNight,
          status: "created",
          currentGuestId: null,
        }),
      },

      RoomMadeAvailable: {
        id: (event) => event.payload.roomId,
        reduce: (_event, view) => ({
          ...view,
          status: "available",
          currentGuestId: null,
        }),
      },

      RoomReserved: {
        id: (event) => event.payload.roomId,
        reduce: (event, view) => ({
          ...view,
          status: "reserved",
          currentGuestId: event.payload.guestId,
        }),
      },

      GuestCheckedIn: {
        id: (event) => event.payload.roomId,
        reduce: (event, view) => ({
          ...view,
          status: "occupied",
          currentGuestId: event.payload.guestId,
        }),
      },

      GuestCheckedOut: {
        id: (event) => event.payload.roomId,
        reduce: (_event, view) => ({
          ...view,
          status: "available",
          currentGuestId: null,
        }),
      },

      RoomUnderMaintenance: {
        id: (event) => event.payload.roomId,
        reduce: (_event, view) => ({
          ...view,
          status: "maintenance",
          currentGuestId: null,
        }),
      },
    },

    queryHandlers: {
      GetRoomAvailability: async (query, { views }) =>
        (await views.load(query.roomId)) ?? null,

      ListAvailableRooms: async (query, { views }) =>
        views.findAvailable(query.type),
    },
  });
