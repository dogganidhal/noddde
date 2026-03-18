import { DefineQueries } from "@noddde/core";
import { OrderSummary } from "./infrastructure";

export type OrderSummaryQuery = DefineQueries<{
  GetOrderSummary: {
    payload: { orderId: string };
    result: OrderSummary | null;
  };
}>;
