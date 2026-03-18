import { DefineCommands } from "@noddde/core";
import { OrderItem } from "./events";

export type OrderCommand = DefineCommands<{
  PlaceOrder: {
    customerId: string;
    items: OrderItem[];
  };
  ConfirmOrder: void;
  CancelOrder: { reason: string };
  MarkOrderShipped: { trackingNumber: string };
  MarkOrderDelivered: void;
}>;
