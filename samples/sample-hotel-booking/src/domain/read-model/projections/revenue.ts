import type { ViewStore } from "@noddde/core";
import { defineProjection } from "@noddde/core";
import type { HotelInfrastructure } from "../../../infrastructure/types";
import type { BookingEvent } from "../../write-model/booking/events";
import type { RevenueView, RevenueQuery } from "../queries";

type RevenueProjectionDef = {
  events: BookingEvent;
  queries: RevenueQuery;
  view: RevenueView;
  infrastructure: HotelInfrastructure;
  viewStore: ViewStore<RevenueView>;
};

/**
 * Aggregates daily revenue from completed payments.
 * Keyed by date (from PaymentCompleted.completedAt).
 */
export const RevenueProjection = defineProjection<RevenueProjectionDef>({
  initialView: {
    date: "",
    totalRevenue: 0,
    bookingCount: 0,
  },

  reducers: {
    PaymentCompleted: (event, view) => ({
      date: event.payload.completedAt.split("T")[0]!,
      totalRevenue: view.totalRevenue + event.payload.amount,
      bookingCount: view.bookingCount + 1,
    }),
    // Pass-through: only PaymentCompleted affects revenue
    BookingCreated: (_event, view) => view,
    BookingConfirmed: (_event, view) => view,
    BookingCancelled: (_event, view) => view,
    BookingModified: (_event, view) => view,
    PaymentRequested: (_event, view) => view,
    PaymentFailed: (_event, view) => view,
    PaymentRefunded: (_event, view) => view,
  },

  identity: {
    PaymentCompleted: (event) => event.payload.completedAt.split("T")[0]!,
    BookingCreated: (event) => event.payload.bookingId,
    BookingConfirmed: (event) => event.payload.bookingId,
    BookingCancelled: (event) => event.payload.bookingId,
    BookingModified: (event) => event.payload.bookingId,
    PaymentRequested: (event) => event.payload.bookingId,
    PaymentFailed: (event) => event.payload.bookingId,
    PaymentRefunded: (event) => event.payload.bookingId,
  },

  viewStore: (infra) => infra.revenueViewStore,

  queryHandlers: {
    GetDailyRevenue: async (query, { views }) =>
      (await views.load(query.date)) ?? null,
  },
});
