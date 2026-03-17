import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
  InMemorySagaPersistence,
} from "@noddde/core";
import { Order } from "./order/aggregate";
import { Payment } from "./payment/aggregate";
import { Shipping } from "./shipping/aggregate";
import { OrderFulfillmentSaga } from "./saga/order-fulfillment";
import { OrderSummaryProjection } from "./projection";
import {
  EcommerceInfrastructure,
  SystemClock,
  ConsoleNotificationService,
  InMemoryOrderSummaryRepository,
} from "./infrastructure";
import { randomUUID } from "crypto";

const main = async () => {
  // ── Wire up the full domain ──────────────────────────────────
  const domain = await configureDomain<EcommerceInfrastructure>({
    writeModel: {
      aggregates: {
        Order,
        Payment,
        Shipping,
      },
    },
    readModel: {
      projections: {
        OrderSummary: OrderSummaryProjection,
      },
    },
    processModel: {
      sagas: {
        OrderFulfillment: OrderFulfillmentSaga,
      },
    },
    infrastructure: {
      aggregatePersistence: () =>
        new InMemoryEventSourcedAggregatePersistence(),
      sagaPersistence: () => new InMemorySagaPersistence(),
      provideInfrastructure: () => ({
        clock: new SystemClock(),
        notificationService: new ConsoleNotificationService(),
        orderSummaryRepository: new InMemoryOrderSummaryRepository(),
      }),
      cqrsInfrastructure: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    },
  });

  // ── Place an order ───────────────────────────────────────────
  // This dispatches PlaceOrder → emits OrderPlaced → saga picks it up
  // → saga dispatches RequestPayment to the Payment aggregate
  const orderId = randomUUID();

  await domain.dispatchCommand({
    name: "PlaceOrder",
    targetAggregateId: orderId,
    payload: {
      customerId: "customer-42",
      items: [
        { productId: "prod-1", quantity: 2, unitPrice: 29.99 },
        { productId: "prod-2", quantity: 1, unitPrice: 49.99 },
      ],
    },
  });

  // At this point the saga has:
  // 1. Reacted to OrderPlaced
  // 2. Updated its state to { status: "awaiting_payment", paymentId: "..." }
  // 3. Returned a RequestPayment command for the framework to dispatch
  //
  // When Payment processes RequestPayment → emits PaymentCompleted → saga reacts:
  // 4. Dispatches ConfirmOrder to Order aggregate
  // 5. Dispatches ArrangeShipment to Shipping aggregate
  //
  // When Shipping dispatches → emits ShipmentDispatched → saga reacts:
  // 6. Dispatches MarkOrderShipped to Order aggregate
  //
  // When delivery is confirmed → emits ShipmentDelivered → saga reacts:
  // 7. Notifies the customer via infrastructure
  // 8. Dispatches MarkOrderDelivered to Order aggregate
  // 9. Saga state reaches "delivered" — workflow complete
};

main();
