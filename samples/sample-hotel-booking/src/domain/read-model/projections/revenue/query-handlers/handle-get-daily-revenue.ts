import type { ViewStore } from "@noddde/core";
import type { GetDailyRevenuePayload } from "../queries/get-daily-revenue";
import type { RevenueView } from "../revenue";

/** Handles the GetDailyRevenue query by loading the view from the store. */
export const handleGetDailyRevenue = async (
  query: GetDailyRevenuePayload,
  { views }: { views: ViewStore<RevenueView> },
): Promise<RevenueView | null> => (await views.load(query.date)) ?? null;
