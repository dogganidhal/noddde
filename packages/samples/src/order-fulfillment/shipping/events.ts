import { DefineEvents } from "@noddde/core";

export type ShippingEvent = DefineEvents<{
  ShipmentArranged: {
    shipmentId: string;
    customerReference: string;
    itemCount: number;
    arrangedAt: Date;
  };
  ShipmentDispatched: {
    shipmentId: string;
    customerReference: string;
    trackingNumber: string;
    dispatchedAt: Date;
  };
  ShipmentDelivered: {
    shipmentId: string;
    customerReference: string;
    deliveredAt: Date;
  };
}>;
