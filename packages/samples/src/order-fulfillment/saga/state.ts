import { OrderItem } from "../order/events";

export type FulfillmentStatus =
  | "awaiting_payment"
  | "payment_failed"
  | "awaiting_shipment"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface OrderFulfillmentState {
  orderId: string | null;
  customerId: string | null;
  items: OrderItem[];
  total: number;
  status: FulfillmentStatus | null;
  paymentId: string | null;
  shipmentId: string | null;
  trackingNumber: string | null;
}

export const initialFulfillmentState: OrderFulfillmentState = {
  orderId: null,
  customerId: null,
  items: [],
  total: 0,
  status: null,
  paymentId: null,
  shipmentId: null,
  trackingNumber: null,
};
