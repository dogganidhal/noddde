import { defineProjection } from "@noddde/core";
import type { ViewStore } from "@noddde/core";
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

    on: {
      BookingCreated: {
        id: (event) => event.payload.guestId,
        reduce: (event, view) => ({
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
      },
    },

    queryHandlers: {
      GetGuestHistory: async (query, { views }) =>
        (await views.load(query.guestId)) ?? null,
    },
  });
