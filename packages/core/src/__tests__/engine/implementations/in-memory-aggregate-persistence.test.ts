import { describe, it, expect } from "vitest";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
} from "@noddde/core";

describe("InMemoryEventSourcedAggregatePersistence", () => {
  it("save and load round-trip", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const events = [
      { name: "AccountCreated", payload: { id: "acc-1", owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 100 } },
    ];

    await persistence.save("BankAccount", "acc-1", events);

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toEqual(events);
  });

  it("load returns empty array for unknown aggregate", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const events = await persistence.load("BankAccount", "nonexistent");

    expect(events).toEqual([]);
  });

  it("multiple saves append events in order", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save("BankAccount", "acc-1", [
      { name: "AccountCreated", payload: { id: "acc-1" } },
    ]);
    await persistence.save("BankAccount", "acc-1", [
      { name: "DepositMade", payload: { amount: 50 } },
      { name: "DepositMade", payload: { amount: 75 } },
    ]);

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toHaveLength(3);
    expect(loaded[0]).toEqual({
      name: "AccountCreated",
      payload: { id: "acc-1" },
    });
    expect(loaded[1]).toEqual({ name: "DepositMade", payload: { amount: 50 } });
    expect(loaded[2]).toEqual({ name: "DepositMade", payload: { amount: 75 } });
  });

  it("namespace isolation between aggregate types", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save("Order", "1", [
      { name: "OrderPlaced", payload: { total: 200 } },
    ]);
    await persistence.save("Account", "1", [
      { name: "AccountCreated", payload: { owner: "Bob" } },
    ]);

    const orderEvents = await persistence.load("Order", "1");
    const accountEvents = await persistence.load("Account", "1");

    expect(orderEvents).toHaveLength(1);
    expect(orderEvents[0].name).toBe("OrderPlaced");

    expect(accountEvents).toHaveLength(1);
    expect(accountEvents![0].name).toBe("AccountCreated");
  });

  it("saving empty array is a no-op", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save("BankAccount", "acc-1", [
      { name: "AccountCreated", payload: { id: "acc-1" } },
    ]);
    await persistence.save("BankAccount", "acc-1", []);

    const loaded = await persistence.load("BankAccount", "acc-1");
    expect(loaded).toHaveLength(1);
  });
});

describe("InMemoryStateStoredAggregatePersistence", () => {
  it("save and load round-trip", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const state = { id: "acc-1", balance: 250, owner: "Alice" };
    await persistence.save("BankAccount", "acc-1", state);

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toEqual(state);
  });

  it("load returns undefined for unknown aggregate", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const state = await persistence.load("BankAccount", "nonexistent");

    expect(state == null).toBe(true);
  });

  it("save overwrites previous state", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("BankAccount", "acc-1", { balance: 100 });
    await persistence.save("BankAccount", "acc-1", { balance: 250 });

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toEqual({ balance: 250 });
  });

  it("namespace isolation between aggregate types", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("Order", "1", { status: "placed" });
    await persistence.save("Account", "1", { balance: 500 });

    const orderState = await persistence.load("Order", "1");
    const accountState = await persistence.load("Account", "1");

    expect(orderState).toEqual({ status: "placed" });
    expect(accountState).toEqual({ balance: 500 });
  });
});
