import type { RevenueView } from "../revenue";

/** Payload for querying daily revenue. */
export interface GetDailyRevenuePayload {
  date: string;
}

/** Result type for GetDailyRevenue query. */
export type GetDailyRevenueResult = RevenueView | null;
