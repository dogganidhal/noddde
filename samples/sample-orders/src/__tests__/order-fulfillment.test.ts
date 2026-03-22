import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  testAggregate,
  testProjection,
  testSaga,
  evolveAggregate,
  testDomain,
} from "@noddde/testing";
import { Order } from "../order/aggregate";
import { Payment } from "../payment/aggregate";
import { Shipping } from "../shipping/aggregate";
import { OrderFulfillmentSaga } from "../saga/order-fulfillment";
import { initialFulfillmentState } from "../saga/state";
import { OrderSummaryProjection } from "../projection";
import { FixedClock } from "../infrastructure";
import type { OrderItem } from "../order/events";
import type { OrderSummary } from "../infrastructure";
import { InMemoryViewStore } from "@noddde/engine";

// ---- Shared fixtures ----

const fixedDate = new Date("2025-03-15T10:00:00Z");
const fixedClock = new FixedClock(fixedDate);

const mockNotifier = {
  notifyCustomer: vi.fn().mockResolvedValue(undefined),
};

const orderSummaryViewStore = new InMemoryViewStore<OrderSummary>();

const ecomInfra = {
  clock: fixedClock,
  notificationService: mockNotifier,
  orderSummaryViewStore,
};

const sampleItems: OrderItem[] = [
  { productId: "prod-1", quantity: 2, unitPrice: 29.99 },
  { productId: "prod-2", quantity: 1, unitPrice: 49.99 },
];

const sampleTotal = 2 * 29.99 + 49.99; // 109.97

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — Order aggregate
// ═══════════════════════════════════════════════════════════════════

describe("Order aggregate — unit tests", () => {
  describe("PlaceOrder", () => {
    it("should calculate total and emit OrderPlaced", async () => {
      const result = await testAggregate(Order)
        .when({
          name: "PlaceOrder",
          targetAggregateId: "order-1",
          payload: { customerId: "cust-1", items: sampleItems },
        })
        .withInfrastructure(ecomInfra)
        .execute();

      expect(result.events[0]!.name).toBe("OrderPlaced");
      expect(result.events[0]!.payload).toMatchObject({
        orderId: "order-1",
        customerId: "cust-1",
        total: sampleTotal,
        placedAt: fixedDate,
      });
      expect(result.state.status).toBe("pending");
      expect(result.state.total).toBe(sampleTotal);
    });
  });

  describe("ConfirmOrder", () => {
    it("should confirm a pending order", async () => {
      const result = await testAggregate(Order)
        .given({
          name: "OrderPlaced",
          payload: {
            orderId: "o-1",
            customerId: "c-1",
            items: sampleItems,
            total: sampleTotal,
            placedAt: fixedDate,
          },
        })
        .when({ name: "ConfirmOrder", targetAggregateId: "o-1" })
        .withInfrastructure(ecomInfra)
        .execute();

      expect(result.events[0]!.name).toBe("OrderConfirmed");
      expect(result.state.status).toBe("confirmed");
    });

    it("should cancel if order is not pending", async () => {
      const result = await testAggregate(Order)
        .given(
          {
            name: "OrderPlaced",
            payload: {
              orderId: "o-1",
              customerId: "c-1",
              items: sampleItems,
              total: sampleTotal,
              placedAt: fixedDate,
            },
          },
          {
            name: "OrderConfirmed",
            payload: { orderId: "o-1", confirmedAt: fixedDate },
          },
        )
        .when({ name: "ConfirmOrder", targetAggregateId: "o-1" })
        .withInfrastructure(ecomInfra)
        .execute();

      expect(result.events[0]!.name).toBe("OrderCancelled");
      expect((result.events[0]!.payload as any).reason).toContain("confirmed");
    });
  });

  describe("State reconstruction", () => {
    it("should track full order lifecycle via evolveAggregate", () => {
      const state = evolveAggregate(Order, [
        {
          name: "OrderPlaced",
          payload: {
            orderId: "o-1",
            customerId: "c-1",
            items: sampleItems,
            total: sampleTotal,
            placedAt: fixedDate,
          },
        },
        {
          name: "OrderConfirmed",
          payload: { orderId: "o-1", confirmedAt: fixedDate },
        },
        {
          name: "OrderShipped",
          payload: {
            orderId: "o-1",
            trackingNumber: "TRK-123",
            shippedAt: fixedDate,
          },
        },
        {
          name: "OrderDelivered",
          payload: { orderId: "o-1", deliveredAt: fixedDate },
        },
      ]);

      expect(state.status).toBe("delivered");
      expect(state.trackingNumber).toBe("TRK-123");
      expect(state.total).toBe(sampleTotal);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — Payment aggregate
// ═══════════════════════════════════════════════════════════════════

describe("Payment aggregate — unit tests", () => {
  it("should request a payment", async () => {
    const result = await testAggregate(Payment)
      .when({
        name: "RequestPayment",
        targetAggregateId: "pay-1",
        payload: { referenceId: "order-1", amount: 109.97 },
      })
      .withInfrastructure(ecomInfra)
      .execute();

    expect(result.events[0]!.name).toBe("PaymentRequested");
    expect(result.state.referenceId).toBe("order-1");
    expect(result.state.amount).toBe(109.97);
    expect(result.state.status).toBe("pending");
  });

  it("should complete a payment", async () => {
    const result = await testAggregate(Payment)
      .given({
        name: "PaymentRequested",
        payload: {
          paymentId: "pay-1",
          referenceId: "order-1",
          amount: 109.97,
          requestedAt: fixedDate,
        },
      })
      .when({ name: "CompletePayment", targetAggregateId: "pay-1" })
      .withInfrastructure(ecomInfra)
      .execute();

    expect(result.events[0]!.name).toBe("PaymentCompleted");
    expect(result.state.status).toBe("completed");
  });

  it("should refund a payment", async () => {
    const result = await testAggregate(Payment)
      .given(
        {
          name: "PaymentRequested",
          payload: {
            paymentId: "pay-1",
            referenceId: "o-1",
            amount: 100,
            requestedAt: fixedDate,
          },
        },
        {
          name: "PaymentCompleted",
          payload: {
            paymentId: "pay-1",
            referenceId: "o-1",
            amount: 100,
            completedAt: fixedDate,
          },
        },
      )
      .when({
        name: "RefundPayment",
        targetAggregateId: "pay-1",
        payload: { reason: "Customer cancelled" },
      })
      .withInfrastructure(ecomInfra)
      .execute();

    expect(result.events[0]!.name).toBe("PaymentRefunded");
    expect(result.state.status).toBe("refunded");
  });
});

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — Shipping aggregate
// ═══════════════════════════════════════════════════════════════════

describe("Shipping aggregate — unit tests", () => {
  it("should arrange a shipment", async () => {
    const result = await testAggregate(Shipping)
      .when({
        name: "ArrangeShipment",
        targetAggregateId: "ship-1",
        payload: { customerReference: "order-1", itemCount: 3 },
      })
      .withInfrastructure(ecomInfra)
      .execute();

    expect(result.events[0]!.name).toBe("ShipmentArranged");
    expect(result.state.customerReference).toBe("order-1");
    expect(result.state.itemCount).toBe(3);
    expect(result.state.status).toBe("arranging");
  });

  it("should track full shipment lifecycle", () => {
    const state = evolveAggregate(Shipping, [
      {
        name: "ShipmentArranged",
        payload: {
          shipmentId: "s-1",
          customerReference: "o-1",
          itemCount: 2,
          arrangedAt: fixedDate,
        },
      },
      {
        name: "ShipmentDispatched",
        payload: {
          shipmentId: "s-1",
          customerReference: "o-1",
          trackingNumber: "TRK-456",
          dispatchedAt: fixedDate,
        },
      },
      {
        name: "ShipmentDelivered",
        payload: {
          shipmentId: "s-1",
          customerReference: "o-1",
          deliveredAt: fixedDate,
        },
      },
    ]);

    expect(state.status).toBe("delivered");
    expect(state.trackingNumber).toBe("TRK-456");
  });
});

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — OrderFulfillmentSaga (testSaga)
// ═══════════════════════════════════════════════════════════════════

describe("OrderFulfillmentSaga — unit tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("OrderPlaced → request payment", () => {
    it("should transition to awaiting_payment and dispatch RequestPayment", async () => {
      const result = await testSaga(OrderFulfillmentSaga)
        .when({
          name: "OrderPlaced",
          payload: {
            orderId: "o-1",
            customerId: "c-1",
            items: sampleItems,
            total: sampleTotal,
            placedAt: fixedDate,
          },
        })
        .execute();

      expect(result.state.status).toBe("awaiting_payment");
      expect(result.state.orderId).toBe("o-1");
      expect(result.state.total).toBe(sampleTotal);
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0]!.name).toBe("RequestPayment");
      expect((result.commands[0]! as any).payload).toMatchObject({
        referenceId: "o-1",
        amount: sampleTotal,
      });
    });
  });

  describe("PaymentCompleted → confirm + arrange shipment", () => {
    it("should dispatch TWO commands: ConfirmOrder and ArrangeShipment", async () => {
      const sagaState = {
        ...initialFulfillmentState,
        orderId: "o-1",
        customerId: "c-1",
        items: sampleItems,
        total: sampleTotal,
        status: "awaiting_payment" as const,
        paymentId: "pay-1",
      };

      const result = await testSaga(OrderFulfillmentSaga)
        .givenState(sagaState)
        .when({
          name: "PaymentCompleted",
          payload: {
            paymentId: "pay-1",
            referenceId: "o-1",
            amount: sampleTotal,
            completedAt: fixedDate,
          },
        })
        .execute();

      expect(result.state.status).toBe("awaiting_shipment");
      expect(result.commands).toHaveLength(2);
      expect(result.commands[0]!.name).toBe("ConfirmOrder");
      expect(result.commands[1]!.name).toBe("ArrangeShipment");
      expect((result.commands[1]! as any).payload).toMatchObject({
        customerReference: "o-1",
        itemCount: 3, // 2 + 1
      });
    });
  });

  describe("PaymentFailed → cancel order", () => {
    it("should dispatch CancelOrder with failure reason", async () => {
      const sagaState = {
        ...initialFulfillmentState,
        orderId: "o-1",
        customerId: "c-1",
        status: "awaiting_payment" as const,
        paymentId: "pay-1",
      };

      const result = await testSaga(OrderFulfillmentSaga)
        .givenState(sagaState)
        .when({
          name: "PaymentFailed",
          payload: {
            paymentId: "pay-1",
            referenceId: "o-1",
            reason: "Insufficient funds",
            failedAt: fixedDate,
          },
        })
        .execute();

      expect(result.state.status).toBe("payment_failed");
      expect(result.commands).toEqual([
        {
          name: "CancelOrder",
          targetAggregateId: "o-1",
          payload: { reason: "Payment failed: Insufficient funds" },
        },
      ]);
    });
  });

  describe("ShipmentDelivered → notify + mark delivered", () => {
    it("should call notification service and dispatch MarkOrderDelivered", async () => {
      const sagaState = {
        ...initialFulfillmentState,
        orderId: "o-1",
        customerId: "c-1",
        status: "shipped" as const,
        trackingNumber: "TRK-123",
      };

      const result = await testSaga(OrderFulfillmentSaga)
        .givenState(sagaState)
        .when({
          name: "ShipmentDelivered",
          payload: {
            shipmentId: "ship-1",
            customerReference: "o-1",
            deliveredAt: fixedDate,
          },
        })
        .withInfrastructure(ecomInfra)
        .execute();

      expect(result.state.status).toBe("delivered");
      expect(result.commands).toEqual([
        {
          name: "MarkOrderDelivered",
          targetAggregateId: "o-1",
        },
      ]);
      expect(mockNotifier.notifyCustomer).toHaveBeenCalledWith(
        "c-1",
        "Your order o-1 has been delivered!",
      );
    });
  });

  describe("OrderCancelled → conditional refund", () => {
    it("should refund when payment was taken", async () => {
      const sagaState = {
        ...initialFulfillmentState,
        orderId: "o-1",
        customerId: "c-1",
        status: "awaiting_shipment" as const,
        paymentId: "pay-1",
      };

      const result = await testSaga(OrderFulfillmentSaga)
        .givenState(sagaState)
        .when({
          name: "OrderCancelled",
          payload: {
            orderId: "o-1",
            reason: "Changed my mind",
            cancelledAt: fixedDate,
          },
        })
        .withInfrastructure(ecomInfra)
        .execute();

      expect(result.state.status).toBe("cancelled");
      expect(result.commands).toEqual([
        {
          name: "RefundPayment",
          targetAggregateId: "pay-1",
          payload: { reason: "Changed my mind" },
        },
      ]);
    });

    it("should NOT refund when no payment was taken", async () => {
      const sagaState = {
        ...initialFulfillmentState,
        orderId: "o-1",
        customerId: "c-1",
        status: "awaiting_payment" as const,
        paymentId: null,
      };

      const result = await testSaga(OrderFulfillmentSaga)
        .givenState(sagaState)
        .when({
          name: "OrderCancelled",
          payload: {
            orderId: "o-1",
            reason: "Changed my mind",
            cancelledAt: fixedDate,
          },
        })
        .withInfrastructure(ecomInfra)
        .execute();

      expect(result.state.status).toBe("cancelled");
      expect(result.commands).toEqual([]);
    });
  });

  describe("Observation-only events", () => {
    it("should update state without dispatching commands for OrderConfirmed", async () => {
      const result = await testSaga(OrderFulfillmentSaga)
        .givenState({
          ...initialFulfillmentState,
          orderId: "o-1",
          status: "awaiting_shipment" as const,
        })
        .when({
          name: "OrderConfirmed",
          payload: { orderId: "o-1", confirmedAt: fixedDate },
        })
        .execute();

      expect(result.commands).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — testSaga associations
// ═══════════════════════════════════════════════════════════════════

describe("OrderFulfillmentSaga associations", () => {
  it("should extract orderId from Order events", () => {
    expect(
      OrderFulfillmentSaga.associations.OrderPlaced({
        name: "OrderPlaced",
        payload: {
          orderId: "o-1",
          customerId: "c-1",
          items: [],
          total: 0,
          placedAt: fixedDate,
        },
      }),
    ).toBe("o-1");
  });

  it("should extract referenceId from Payment events", () => {
    expect(
      OrderFulfillmentSaga.associations.PaymentCompleted({
        name: "PaymentCompleted",
        payload: {
          paymentId: "p-1",
          referenceId: "o-1",
          amount: 100,
          completedAt: fixedDate,
        },
      }),
    ).toBe("o-1");
  });

  it("should extract customerReference from Shipping events", () => {
    expect(
      OrderFulfillmentSaga.associations.ShipmentDispatched({
        name: "ShipmentDispatched",
        payload: {
          shipmentId: "s-1",
          customerReference: "o-1",
          trackingNumber: "TRK",
          dispatchedAt: fixedDate,
        },
      }),
    ).toBe("o-1");
  });
});

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — OrderSummaryProjection
// ═══════════════════════════════════════════════════════════════════

describe("OrderSummaryProjection — unit tests", () => {
  it("should build a complete order summary from events", async () => {
    const result = await testProjection(OrderSummaryProjection)
      .given(
        {
          name: "OrderPlaced",
          payload: {
            orderId: "o-1",
            customerId: "c-1",
            items: sampleItems,
            total: sampleTotal,
            placedAt: fixedDate,
          },
        },
        {
          name: "OrderConfirmed",
          payload: { orderId: "o-1", confirmedAt: fixedDate },
        },
        {
          name: "OrderShipped",
          payload: {
            orderId: "o-1",
            trackingNumber: "TRK-789",
            shippedAt: fixedDate,
          },
        },
        {
          name: "OrderDelivered",
          payload: { orderId: "o-1", deliveredAt: fixedDate },
        },
      )
      .execute();

    expect(result.view).toEqual({
      orderId: "o-1",
      customerId: "c-1",
      status: "delivered",
      total: sampleTotal,
      itemCount: 3,
      trackingNumber: "TRK-789",
    });
  });

  it("should show cancelled status", async () => {
    const result = await testProjection(OrderSummaryProjection)
      .given(
        {
          name: "OrderPlaced",
          payload: {
            orderId: "o-1",
            customerId: "c-1",
            items: sampleItems,
            total: sampleTotal,
            placedAt: fixedDate,
          },
        },
        {
          name: "OrderCancelled",
          payload: {
            orderId: "o-1",
            reason: "Payment failed",
            cancelledAt: fixedDate,
          },
        },
      )
      .execute();

    expect(result.view.status).toBe("cancelled");
    expect(result.view.trackingNumber).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// SLICE TEST — testDomain (full order-to-delivery)
// ═══════════════════════════════════════════════════════════════════

describe("Order fulfillment domain — slice test", () => {
  it("should place an order and have the saga request payment", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { Order },
      projections: { OrderSummaryProjection },
      sagas: { OrderFulfillmentSaga },
      infrastructure: ecomInfra,
    });

    await domain.dispatchCommand({
      name: "PlaceOrder",
      targetAggregateId: "order-1",
      payload: { customerId: "cust-1", items: sampleItems },
    });

    // Aggregate should have emitted OrderPlaced
    expect(spy.publishedEvents[0]!.name).toBe("OrderPlaced");

    // Saga should have dispatched RequestPayment
    expect(spy.dispatchedCommands).toContainEqual(
      expect.objectContaining({
        name: "RequestPayment",
        payload: expect.objectContaining({
          referenceId: "order-1",
          amount: sampleTotal,
        }),
      }),
    );

    // Projection should have persisted the view via ViewStore
    const summary = await orderSummaryViewStore.load("order-1");
    expect(summary?.status).toBe("pending");
    expect(summary?.total).toBe(sampleTotal);
    expect(summary?.itemCount).toBe(3);
  });
});
