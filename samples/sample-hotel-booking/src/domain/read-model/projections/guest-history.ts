import type { ViewStore } from "@noddde/core";
import { defineProjection } from "@noddde/core";
import type { HotelInfrastructure } from "../../../infrastructure/types";
import type { BookingEvent } from "../../write-model/booking/events";
import type { GuestHistoryView, GuestHistoryQuery } from "../queries";

type GuestHistoryProjectionDef = {
  events: BookingEvent;
  queries: GuestHistoryQuery;
  view: GuestHistoryView;
  infrastructure: HotelInfrastructure;
  viewStore: ViewStore<GuestHistoryView>;
};

/**
 * Tracks booking history per guest. Only reacts to BookingCreated since
 * that is the only booking event that carries guestId. In production,
 * you would denormalize guestId into subsequent events to also track
 * status changes.
 */
export const GuestHistoryProjection =
  defineProjection<GuestHistoryProjectionDef>({
    initialView: {
      guestId: "",
      bookings: [],
    },

    reducers: {
      BookingCreated: (event, view) => ({
        guestId: event.payload.guestId,
        bookings: [
          ...view.bookings,
          {
            bookingId: event.payload.bookingId,
            roomType: event.payload.roomType,
            checkIn: event.payload.checkIn,
            checkOut: event.payload.checkOut,
            status: "pending",
          },
        ],
      }),
      // Pass-through: these events don't carry guestId
      BookingConfirmed: (_event, view) => view,
      BookingCancelled: (_event, view) => view,
      BookingModified: (_event, view) => view,
      PaymentRequested: (_event, view) => view,
      PaymentCompleted: (_event, view) => view,
      PaymentFailed: (_event, view) => view,
      PaymentRefunded: (_event, view) => view,
    },

    // Identity: only BookingCreated carries guestId. Pass-through events
    // use a sentinel ID so the engine doesn't create orphaned views keyed
    // by bookingId (which nobody queries). In production, denormalize guestId
    // into all booking events to enable full status tracking per guest.
    identity: {
      BookingCreated: (event) => event.payload.guestId,
      BookingConfirmed: () => "__noop__",
      BookingCancelled: () => "__noop__",
      BookingModified: () => "__noop__",
      PaymentRequested: () => "__noop__",
      PaymentCompleted: () => "__noop__",
      PaymentFailed: () => "__noop__",
      PaymentRefunded: () => "__noop__",
    },

    viewStore: (infra) => infra.guestHistoryViewStore,

    queryHandlers: {
      GetGuestHistory: async (query, { views }) =>
        (await views.load(query.guestId)) ?? null,
    },
  });
