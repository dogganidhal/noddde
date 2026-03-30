import type { InferProjectionQueryHandler } from "@noddde/core";
import type { RevenueProjectionDef } from "../revenue";

/** Handles the GetDailyRevenue query by loading the view from the store. */
export const handleGetDailyRevenue: InferProjectionQueryHandler<
  RevenueProjectionDef,
  "GetDailyRevenue"
> = async (query, { views }) => (await views.load(query.date)) ?? null;
