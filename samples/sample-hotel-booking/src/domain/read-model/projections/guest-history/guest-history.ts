import { defineProjection } from "@noddde/core";
import type { ViewStore } from "@noddde/core";
import type { RoomType } from "../../../../infrastructure/types";
import type { HotelInfrastructure } from "../../../../infrastructure/types";
import type { BookingEvent } from "../../../event-model";
import type { GuestHistoryQuery } from "./queries";

/** View for guest booking history. */
export interface GuestHistoryView {
  guestId: string;
  bookings: Array<{
    bookingId: string;
    roomType: RoomType;
    checkIn: string;
    checkOut: string;
    status: string;
  }>;
}

/** Type bundle for the GuestHistory projection. */
type GuestHistoryProjectionDef = {
  events: BookingEvent;
  queries: GuestHistoryQuery;
  view: GuestHistoryView;
  infrastructure: HotelInfrastructure;
  viewStore: ViewStore<GuestHistoryView>;
};

/**
 * Guest history projection definition.
 *
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
