import type { ViewStore } from "@noddde/core";
import { defineProjection } from "@noddde/core";
import { EcommerceInfrastructure, OrderSummary } from "./infrastructure";
import { OrderEvent } from "./order/events";
import { OrderSummaryQuery } from "./queries";

type OrderSummaryProjectionDef = {
  events: OrderEvent;
  queries: OrderSummaryQuery;
  view: OrderSummary;
  infrastructure: EcommerceInfrastructure;
  viewStore: ViewStore<OrderSummary>;
};

export const OrderSummaryProjection =
  defineProjection<OrderSummaryProjectionDef>({
    reducers: {
      OrderPlaced: (event) => ({
        orderId: event.payload.orderId,
        customerId: event.payload.customerId,
        status: "pending",
        total: event.payload.total,
        itemCount: event.payload.items.reduce(
          (sum, item) => sum + item.quantity,
          0,
        ),
        trackingNumber: null,
      }),

      OrderConfirmed: (_event, view) => ({
        ...view,
        status: "confirmed",
      }),

      OrderCancelled: (_event, view) => ({
        ...view,
        status: "cancelled",
      }),

      OrderShipped: (event, view) => ({
        ...view,
        status: "shipped",
        trackingNumber: event.payload.trackingNumber,
      }),

      OrderDelivered: (_event, view) => ({
        ...view,
        status: "delivered",
      }),
    },

    identity: {
      OrderPlaced: (event) => event.payload.orderId,
      OrderConfirmed: (event) => event.payload.orderId,
      OrderCancelled: (event) => event.payload.orderId,
      OrderShipped: (event) => event.payload.orderId,
      OrderDelivered: (event) => event.payload.orderId,
    },

    viewStore: (infra) => infra.orderSummaryViewStore,

    queryHandlers: {
      GetOrderSummary: async (query, { views }) =>
        (await views.load(query.orderId)) ?? null,
    },
  });
