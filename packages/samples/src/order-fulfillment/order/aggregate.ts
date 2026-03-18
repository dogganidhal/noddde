import { defineAggregate } from "@noddde/core";
import { EcommerceInfrastructure } from "../infrastructure";
import { OrderCommand } from "./commands";
import { OrderEvent, OrderItem } from "./events";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface OrderState {
  customerId: string | null;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  trackingNumber: string | null;
}

type OrderDef = {
  state: OrderState;
  events: OrderEvent;
  commands: OrderCommand;
  infrastructure: EcommerceInfrastructure;
};

export const Order = defineAggregate<OrderDef>({
  initialState: {
    customerId: null,
    items: [],
    total: 0,
    status: "pending",
    trackingNumber: null,
  },

  commands: {
    PlaceOrder: (command, _state, { clock }) => {
      const total = command.payload.items.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0,
      );
      return {
        name: "OrderPlaced",
        payload: {
          orderId: command.targetAggregateId,
          customerId: command.payload.customerId,
          items: command.payload.items,
          total,
          placedAt: clock.now(),
        },
      };
    },

    ConfirmOrder: (command, state, { clock }) => {
      if (state.status !== "pending") {
        return {
          name: "OrderCancelled",
          payload: {
            orderId: command.targetAggregateId,
            reason: `Cannot confirm order in ${state.status} status`,
            cancelledAt: clock.now(),
          },
        };
      }
      return {
        name: "OrderConfirmed",
        payload: {
          orderId: command.targetAggregateId,
          confirmedAt: clock.now(),
        },
      };
    },

    CancelOrder: (command, _state, { clock }) => ({
      name: "OrderCancelled",
      payload: {
        orderId: command.targetAggregateId,
        reason: command.payload.reason,
        cancelledAt: clock.now(),
      },
    }),

    MarkOrderShipped: (command, _state, { clock }) => ({
      name: "OrderShipped",
      payload: {
        orderId: command.targetAggregateId,
        trackingNumber: command.payload.trackingNumber,
        shippedAt: clock.now(),
      },
    }),

    MarkOrderDelivered: (command, _state, { clock }) => ({
      name: "OrderDelivered",
      payload: {
        orderId: command.targetAggregateId,
        deliveredAt: clock.now(),
      },
    }),
  },

  apply: {
    OrderPlaced: (event) => ({
      customerId: event.customerId,
      items: event.items,
      total: event.total,
      status: "pending" as const,
      trackingNumber: null,
    }),

    OrderConfirmed: (_event, state) => ({
      ...state,
      status: "confirmed" as const,
    }),

    OrderCancelled: (_event, state) => ({
      ...state,
      status: "cancelled" as const,
    }),

    OrderShipped: (event, state) => ({
      ...state,
      status: "shipped" as const,
      trackingNumber: event.trackingNumber,
    }),

    OrderDelivered: (_event, state) => ({
      ...state,
      status: "delivered" as const,
    }),
  },
});
