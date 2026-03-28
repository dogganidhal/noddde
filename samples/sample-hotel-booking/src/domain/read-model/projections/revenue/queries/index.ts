import type { DefineQueries } from "@noddde/core";
import type { RevenueView } from "../revenue";
import type { GetDailyRevenuePayload } from "./get-daily-revenue";

export type { GetDailyRevenuePayload } from "./get-daily-revenue";

/** Discriminated union of all revenue queries. */
export type RevenueQuery = DefineQueries<{
  GetDailyRevenue: {
    payload: GetDailyRevenuePayload;
    result: RevenueView | null;
  };
}>;
