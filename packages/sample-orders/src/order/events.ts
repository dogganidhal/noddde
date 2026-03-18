import { DefineEvents } from "@noddde/core";

export type OrderItem = {
  productId: string;
  quantity: number;
  unitPrice: number;
};

export type OrderEvent = DefineEvents<{
  OrderPlaced: {
    orderId: string;
    customerId: string;
    items: OrderItem[];
    total: number;
    placedAt: Date;
  };
  OrderConfirmed: {
    orderId: string;
    confirmedAt: Date;
  };
  OrderCancelled: {
    orderId: string;
    reason: string;
    cancelledAt: Date;
  };
  OrderShipped: {
    orderId: string;
    trackingNumber: string;
    shippedAt: Date;
  };
  OrderDelivered: {
    orderId: string;
    deliveredAt: Date;
  };
}>;
