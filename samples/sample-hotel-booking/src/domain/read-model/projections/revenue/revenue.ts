import { defineProjection } from "@noddde/core";
import type { ViewStore } from "@noddde/core";
import type { HotelPorts } from "../../../../infrastructure/types";
import type { BookingEvent } from "../../../event-model";
import type { RevenueQuery } from "./queries";
import { onPaymentCompleted } from "./on-entries";
import { handleGetDailyRevenue } from "./query-handlers";

/** View for daily revenue aggregation. */
export interface RevenueView {
  date: string;
  totalRevenue: number;
  bookingCount: number;
}

/** Type bundle for the Revenue projection. */
export type RevenueProjectionDef = {
  events: BookingEvent;
  queries: RevenueQuery;
  view: RevenueView;
  ports: HotelPorts;
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
    PaymentCompleted: onPaymentCompleted,
  },

  queryHandlers: {
    GetDailyRevenue: handleGetDailyRevenue,
  },
});
