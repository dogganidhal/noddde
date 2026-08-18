import { describe, it, expect } from "vitest";
import { ConcurrencyError } from "@noddde/core";
import { InMemorySagaPersistence } from "@noddde/engine";

describe("InMemorySagaPersistence", () => {
  it("save and load round-trip", async () => {
    const persistence = new InMemorySagaPersistence();

    const state = { status: "awaiting_payment", orderId: "order-1" };
    await persistence.save("OrderFulfillment", "order-1", state, 0);

    const loaded = await persistence.load("OrderFulfillment", "order-1");

    expect(loaded).toEqual({ state, version: 1 });
  });

  it("load returns null for nonexistent saga instance", async () => {
    const persistence = new InMemorySagaPersistence();

    const loaded = await persistence.load("OrderFulfillment", "nonexistent");

    expect(loaded).toBeNull();
  });

  it("save overwrites previous state when expectedVersion matches", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save(
      "OrderFulfillment",
      "order-1",
      { status: "awaiting_payment" },
      0,
    );
    await persistence.save(
      "OrderFulfillment",
      "order-1",
      { status: "awaiting_shipment" },
      1,
    );

    const loaded = await persistence.load("OrderFulfillment", "order-1");

    expect(loaded).toEqual({
      state: { status: "awaiting_shipment" },
      version: 2,
    });
  });

  it("throws ConcurrencyError when expectedVersion is stale", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save(
      "OrderFulfillment",
      "order-1",
      { status: "awaiting_payment" },
      0,
    );

    await expect(
      persistence.save(
        "OrderFulfillment",
        "order-1",
        { status: "awaiting_shipment" },
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("namespace isolation between saga types", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save(
      "OrderFulfillment",
      "1",
      { status: "awaiting_payment" },
      0,
    );
    await persistence.save(
      "PaymentReconciliation",
      "1",
      { reconciled: false },
      0,
    );

    const orderState = await persistence.load("OrderFulfillment", "1");
    const paymentState = await persistence.load("PaymentReconciliation", "1");

    expect(orderState).toEqual({
      state: { status: "awaiting_payment" },
      version: 1,
    });
    expect(paymentState).toEqual({ state: { reconciled: false }, version: 1 });
  });

  it("multiple instances of the same saga type are independent", async () => {
    const persistence = new InMemorySagaPersistence();

    await persistence.save(
      "OrderFulfillment",
      "order-1",
      { status: "awaiting_payment" },
      0,
    );
    await persistence.save(
      "OrderFulfillment",
      "order-2",
      { status: "shipped" },
      0,
    );

    const state1 = await persistence.load("OrderFulfillment", "order-1");
    const state2 = await persistence.load("OrderFulfillment", "order-2");

    expect(state1).toEqual({
      state: { status: "awaiting_payment" },
      version: 1,
    });
    expect(state2).toEqual({ state: { status: "shipped" }, version: 1 });
  });

  it("save then immediate load reflects the latest state and version", async () => {
    const persistence = new InMemorySagaPersistence();

    for (let i = 0; i < 10; i++) {
      await persistence.save("Counter", "c-1", { count: i }, i);
    }

    const loaded = await persistence.load("Counter", "c-1");

    expect(loaded).toEqual({ state: { count: 9 }, version: 10 });
  });
});
