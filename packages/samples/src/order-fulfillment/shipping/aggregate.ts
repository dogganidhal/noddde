import { defineAggregate } from "@noddde/core";
import { EcommerceInfrastructure } from "../infrastructure";
import { ShippingCommand } from "./commands";
import { ShippingEvent } from "./events";

export type ShipmentStatus =
  | "arranging"
  | "dispatched"
  | "delivered";

export interface ShipmentState {
  customerReference: string | null;
  itemCount: number;
  trackingNumber: string | null;
  status: ShipmentStatus;
}

type ShippingDef = {
  state: ShipmentState;
  events: ShippingEvent;
  commands: ShippingCommand;
  infrastructure: EcommerceInfrastructure;
};

export const Shipping = defineAggregate<ShippingDef>({
  initialState: {
    customerReference: null,
    itemCount: 0,
    trackingNumber: null,
    status: "arranging",
  },

  commands: {
    ArrangeShipment: (command, _state, { clock }) => ({
      name: "ShipmentArranged",
      payload: {
        shipmentId: command.targetAggregateId,
        customerReference: command.payload.customerReference,
        itemCount: command.payload.itemCount,
        arrangedAt: clock.now(),
      },
    }),

    DispatchShipment: (command, state, { clock }) => ({
      name: "ShipmentDispatched",
      payload: {
        shipmentId: command.targetAggregateId,
        customerReference: state.customerReference!,
        trackingNumber: command.payload.trackingNumber,
        dispatchedAt: clock.now(),
      },
    }),

    ConfirmDelivery: (command, state, { clock }) => ({
      name: "ShipmentDelivered",
      payload: {
        shipmentId: command.targetAggregateId,
        customerReference: state.customerReference!,
        deliveredAt: clock.now(),
      },
    }),
  },

  apply: {
    ShipmentArranged: (event) => ({
      customerReference: event.customerReference,
      itemCount: event.itemCount,
      trackingNumber: null,
      status: "arranging" as const,
    }),

    ShipmentDispatched: (event, state) => ({
      ...state,
      trackingNumber: event.trackingNumber,
      status: "dispatched" as const,
    }),

    ShipmentDelivered: (_event, state) => ({
      ...state,
      status: "delivered" as const,
    }),
  },
});
