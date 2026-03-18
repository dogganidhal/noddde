import { defineSaga } from "@noddde/core";
import { OrderEvent } from "../order/events";
import { OrderCommand } from "../order/commands";
import { PaymentEvent } from "../payment/events";
import { PaymentCommand } from "../payment/commands";
import { ShippingEvent } from "../shipping/events";
import { ShippingCommand } from "../shipping/commands";
import { EcommerceInfrastructure } from "../infrastructure";
import { OrderFulfillmentState, initialFulfillmentState } from "./state";
import { randomUUID } from "crypto";

// ---- SagaTypes bundle ----
// The saga subscribes to events from all 3 aggregates and may dispatch
// commands to any of them. This is the cross-aggregate coordination
// that a saga exists to handle.

type OrderFulfillmentSagaDef = {
  state: OrderFulfillmentState;
  events: OrderEvent | PaymentEvent | ShippingEvent;
  commands: OrderCommand | PaymentCommand | ShippingCommand;
  infrastructure: EcommerceInfrastructure;
};

// ---- Saga definition ----

export const OrderFulfillmentSaga = defineSaga<OrderFulfillmentSagaDef>({
  initialState: initialFulfillmentState,

  // Only OrderPlaced starts a new saga instance.
  // All other events continue an existing one.
  startedBy: ["OrderPlaced"],

  // Each bounded context names the order correlation field differently.
  // The association map extracts it per event type, fully typed.
  associations: {
    // Order aggregate — uses "orderId" (its own identity)
    OrderPlaced: (event) => event.payload.orderId,
    OrderConfirmed: (event) => event.payload.orderId,
    OrderCancelled: (event) => event.payload.orderId,
    OrderShipped: (event) => event.payload.orderId,
    OrderDelivered: (event) => event.payload.orderId,
    // Payment aggregate — uses "referenceId" (generic payment reference)
    PaymentRequested: (event) => event.payload.referenceId,
    PaymentCompleted: (event) => event.payload.referenceId,
    PaymentFailed: (event) => event.payload.referenceId,
    PaymentRefunded: (event) => event.payload.referenceId,
    // Shipping aggregate — uses "customerReference" (external order ref)
    ShipmentArranged: (event) => event.payload.customerReference,
    ShipmentDispatched: (event) => event.payload.customerReference,
    ShipmentDelivered: (event) => event.payload.customerReference,
  },

  handlers: {
    // ─── Order placed → request payment ───────────────────────────
    OrderPlaced: (event, state) => {
      const paymentId = randomUUID();
      return {
        state: {
          ...state,
          orderId: event.payload.orderId,
          customerId: event.payload.customerId,
          items: event.payload.items,
          total: event.payload.total,
          status: "awaiting_payment" as const,
          paymentId,
        },
        commands: {
          name: "RequestPayment",
          targetAggregateId: paymentId,
          payload: {
            referenceId: event.payload.orderId,
            amount: event.payload.total,
          },
        },
      };
    },

    // ─── Payment completed → confirm order + arrange shipment ─────
    PaymentCompleted: (event, state) => {
      const shipmentId = randomUUID();
      const itemCount = state.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      return {
        state: {
          ...state,
          status: "awaiting_shipment" as const,
          shipmentId,
        },
        // Dispatch TWO commands: confirm the order, then arrange shipping
        commands: [
          {
            name: "ConfirmOrder",
            targetAggregateId: state.orderId!,
          },
          {
            name: "ArrangeShipment",
            targetAggregateId: shipmentId,
            payload: {
              customerReference: event.payload.referenceId,
              itemCount,
            },
          },
        ],
      };
    },

    // ─── Payment failed → cancel the order ────────────────────────
    PaymentFailed: (event, state) => ({
      state: { ...state, status: "payment_failed" as const },
      commands: {
        name: "CancelOrder",
        targetAggregateId: state.orderId!,
        payload: {
          reason: `Payment failed: ${event.payload.reason}`,
        },
      },
    }),

    // ─── Shipment dispatched → mark order as shipped ──────────────
    ShipmentDispatched: (event, state) => ({
      state: {
        ...state,
        trackingNumber: event.payload.trackingNumber,
        status: "shipped" as const,
      },
      commands: {
        name: "MarkOrderShipped",
        targetAggregateId: state.orderId!,
        payload: {
          trackingNumber: event.payload.trackingNumber,
        },
      },
    }),

    // ─── Shipment delivered → mark order as delivered, notify ─────
    ShipmentDelivered: async (event, state, { notificationService }) => {
      await notificationService.notifyCustomer(
        state.customerId!,
        `Your order ${state.orderId} has been delivered!`,
      );
      return {
        state: { ...state, status: "delivered" as const },
        commands: {
          name: "MarkOrderDelivered",
          targetAggregateId: state.orderId!,
        },
      };
    },

    // ─── Order cancelled → refund payment if taken ────────────────
    OrderCancelled: async (event, state, { notificationService }) => {
      await notificationService.notifyCustomer(
        state.customerId!,
        `Your order ${event.payload.orderId} has been cancelled: ${event.payload.reason}`,
      );
      return {
        state: { ...state, status: "cancelled" as const },
        // Only refund if payment was already taken
        commands: state.paymentId
          ? {
              name: "RefundPayment",
              targetAggregateId: state.paymentId,
              payload: { reason: event.payload.reason },
            }
          : undefined,
      };
    },

    // ─── Events the saga observes but doesn't react to ────────────
    // These update state for tracking but dispatch no commands.

    OrderConfirmed: (_event, state) => ({
      state,
    }),

    OrderShipped: (_event, state) => ({
      state,
    }),

    OrderDelivered: (_event, state) => ({
      state,
    }),

    PaymentRequested: (_event, state) => ({
      state,
    }),

    PaymentRefunded: (_event, state) => ({
      state: { ...state, status: "cancelled" as const },
    }),

    ShipmentArranged: (_event, state) => ({
      state,
    }),
  },
});
