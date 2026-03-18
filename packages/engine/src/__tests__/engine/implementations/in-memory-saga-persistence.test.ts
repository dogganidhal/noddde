import { describe, it, expect } from "vitest";
import { InMemorySagaPersistence } from "@noddde/engine";

describe("InMemorySagaPersistence", () => {
  it("save and load round-trip", async () => {
    const persistence = new InMemorySagaPersistence();

    const state = { status: "awaiting_payment", orderId: "order-1" };
    await persistence.save("OrderFulfillment", "order-1", state);

    const loaded = await persistence.load("OrderFulfillment", "order-1");

    expect(loaded).toEqual(state);
  });

  it("load returns undefined for nonexistent saga instance", async () => {
    const persistence = new InMemorySagaPersistence();

    const state = await persistence.load("OrderFulfillment", "nonexistent");

    expect(state).toBeUndefined();
  });

  it("save overwrites previous state", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save("OrderFulfillment", "order-1", {
      status: "awaiting_payment",
    });
    await persistence.save("OrderFulfillment", "order-1", {
      status: "awaiting_shipment",
    });

    const loaded = await persistence.load("OrderFulfillment", "order-1");

    expect(loaded).toEqual({ status: "awaiting_shipment" });
  });

  it("namespace isolation between saga types", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save("OrderFulfillment", "1", {
      status: "awaiting_payment",
    });
    await persistence.save("PaymentReconciliation", "1", {
      reconciled: false,
    });

    const orderState = await persistence.load("OrderFulfillment", "1");
    const paymentState = await persistence.load("PaymentReconciliation", "1");

    expect(orderState).toEqual({ status: "awaiting_payment" });
    expect(paymentState).toEqual({ reconciled: false });
  });

  it("multiple instances of the same saga type are independent", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save("OrderFulfillment", "order-1", {
      status: "awaiting_payment",
    });
    await persistence.save("OrderFulfillment", "order-2", {
      status: "shipped",
    });

    const state1 = await persistence.load("OrderFulfillment", "order-1");
    const state2 = await persistence.load("OrderFulfillment", "order-2");

    expect(state1).toEqual({ status: "awaiting_payment" });
    expect(state2).toEqual({ status: "shipped" });
  });

  it("save then immediate load reflects the latest state", async () => {
    const persistence = new InMemorySagaPersistence();

    for (let i = 0; i < 10; i++) {
      await persistence.save("Counter", "c-1", { count: i });
    }

    const loaded = await persistence.load("Counter", "c-1");

    expect(loaded).toEqual({ count: 9 });
  });
});
