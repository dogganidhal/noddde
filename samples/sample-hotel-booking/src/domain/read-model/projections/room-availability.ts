import { defineProjection } from "@noddde/core";
import type { HotelInfrastructure } from "../../../infrastructure/types";
import type { RoomEvent } from "../../write-model/room/events";
import type {
  RoomAvailabilityView,
  RoomAvailabilityViewStore,
  RoomAvailabilityQuery,
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

    reducers: {
      RoomCreated: (event) => ({
        roomId: event.payload.roomId,
        roomNumber: event.payload.roomNumber,
        type: event.payload.type,
        floor: event.payload.floor,
        pricePerNight: event.payload.pricePerNight,
        status: "created",
        currentGuestId: null,
      }),

      RoomMadeAvailable: (_event, view) => ({
        ...view,
        status: "available",
        currentGuestId: null,
      }),

      RoomReserved: (event, view) => ({
        ...view,
        status: "reserved",
        currentGuestId: event.payload.guestId,
      }),

      GuestCheckedIn: (event, view) => ({
        ...view,
        status: "occupied",
        currentGuestId: event.payload.guestId,
      }),

      GuestCheckedOut: (_event, view) => ({
        ...view,
        status: "available",
        currentGuestId: null,
      }),

      RoomUnderMaintenance: (_event, view) => ({
        ...view,
        status: "maintenance",
        currentGuestId: null,
      }),
    },

    identity: {
      RoomCreated: (event) => event.payload.roomId,
      RoomMadeAvailable: (event) => event.payload.roomId,
      RoomReserved: (event) => event.payload.roomId,
      GuestCheckedIn: (event) => event.payload.roomId,
      GuestCheckedOut: (event) => event.payload.roomId,
      RoomUnderMaintenance: (event) => event.payload.roomId,
    },

    viewStore: (infra) => infra.roomAvailabilityViewStore,

    queryHandlers: {
      GetRoomAvailability: async (query, { views }) =>
        (await views.load(query.roomId)) ?? null,

      ListAvailableRooms: async (query, { views }) =>
        views.findAvailable(query.type),
    },
  });
