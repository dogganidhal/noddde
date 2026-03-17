import { DefineCommands } from "@noddde/core";

export type ShippingCommand = DefineCommands<{
  ArrangeShipment: {
    customerReference: string;
    itemCount: number;
  };
  DispatchShipment: { trackingNumber: string };
  ConfirmDelivery: void;
}>;
