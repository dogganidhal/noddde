import { defineProjection } from "@noddde/core";
import type { ViewStore } from "@noddde/core";
import type { HotelInfrastructure } from "../../../../infrastructure/types";
import type { BookingEvent } from "../../../event-model";
import type { RevenueQuery } from "./queries";

/** View for daily revenue aggregation. */
export interface RevenueView {
  date: string;
  totalRevenue: number;
  bookingCount: number;
}

/** Type bundle for the Revenue projection. */
type RevenueProjectionDef = {
  events: BookingEvent;
  queries: RevenueQuery;
  view: RevenueView;
  infrastructure: HotelInfrastructure;
  viewStore: ViewStore<RevenueView>;
};

/**
 * Revenue projection definition.
 *
 * Aggregates daily revenue from completed payments.
 * Keyed by date (from PaymentCompleted.completedAt).
 */
export const RevenueProjection = defineProjection<RevenueProjectionDef>({
  initialView: {
    date: "",
    totalRevenue: 0,
    bookingCount: 0,
  },

  on: {
    PaymentCompleted: {
      id: (event) => event.payload.completedAt.split("T")[0]!,
      reduce: (event, view) => ({
        date: event.payload.completedAt.split("T")[0]!,
        totalRevenue: view.totalRevenue + event.payload.amount,
        bookingCount: view.bookingCount + 1,
      }),
    },
  },

  queryHandlers: {
    GetDailyRevenue: async (query, { views }) =>
      (await views.load(query.date)) ?? null,
  },
});
