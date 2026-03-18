import { describe, it, expect } from "vitest";
import type {
  StateStoredAggregatePersistence,
  EventSourcedAggregatePersistence,
  SagaPersistence,
} from "@noddde/engine";
import {
  InMemoryStateStoredAggregatePersistence,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySagaPersistence,
} from "@noddde/engine";

describe("Persistence Interface Contracts", () => {
  // ### StateStoredAggregatePersistence contract: save then load returns the state
  describe("StateStoredAggregatePersistence contract", () => {
    function runContractTests(
      createPersistence: () => StateStoredAggregatePersistence,
    ) {
      it("should return the saved state on load", async () => {
        const persistence = createPersistence();
        const state = { balance: 100, owner: "Alice" };

        await persistence.save("BankAccount", "acc-1", state);
        const loaded = await persistence.load("BankAccount", "acc-1");

        expect(loaded).toEqual(state);
      });

      it("should return null or undefined for an unknown aggregate", async () => {
        const persistence = createPersistence();
        const loaded = await persistence.load("BankAccount", "nonexistent");

        expect(loaded == null).toBe(true);
      });

      it("should overwrite state on repeated saves", async () => {
        const persistence = createPersistence();

        await persistence.save("BankAccount", "acc-1", { balance: 100 });
        await persistence.save("BankAccount", "acc-1", { balance: 200 });
        const loaded = await persistence.load("BankAccount", "acc-1");

        expect(loaded).toEqual({ balance: 200 });
      });

      it("should isolate by aggregate name", async () => {
        const persistence = createPersistence();

        await persistence.save("Order", "1", { total: 50 });
        await persistence.save("Account", "1", { balance: 999 });

        expect(await persistence.load("Order", "1")).toEqual({ total: 50 });
        expect(await persistence.load("Account", "1")).toEqual({
          balance: 999,
        });
      });
    }

    describe("InMemoryStateStoredAggregatePersistence", () => {
      runContractTests(() => new InMemoryStateStoredAggregatePersistence());
    });
  });

  // ### EventSourcedAggregatePersistence contract: append and replay
  describe("EventSourcedAggregatePersistence contract", () => {
    function runContractTests(
      createPersistence: () => EventSourcedAggregatePersistence,
    ) {
      it("should return saved events on load", async () => {
        const persistence = createPersistence();
        const events = [
          { name: "AccountCreated", payload: { id: "acc-1" } },
          { name: "DepositMade", payload: { amount: 100 } },
        ];

        await persistence.save("BankAccount", "acc-1", events);
        const loaded = await persistence.load("BankAccount", "acc-1");

        expect(loaded).toEqual(events);
      });

      it("should return empty array for unknown aggregate", async () => {
        const persistence = createPersistence();
        const loaded = await persistence.load("BankAccount", "nonexistent");

        expect(loaded).toEqual([]);
      });

      it("should append events across multiple saves preserving order", async () => {
        const persistence = createPersistence();

        await persistence.save("BankAccount", "acc-1", [
          { name: "AccountCreated", payload: { id: "acc-1" } },
        ]);
        await persistence.save("BankAccount", "acc-1", [
          { name: "DepositMade", payload: { amount: 50 } },
        ]);

        const loaded = await persistence.load("BankAccount", "acc-1");

        expect(loaded).toHaveLength(2);
        expect(loaded[0]!.name).toBe("AccountCreated");
        expect(loaded[1]!.name).toBe("DepositMade");
      });

      it("should isolate by aggregate name", async () => {
        const persistence = createPersistence();

        await persistence.save("Order", "1", [
          { name: "OrderPlaced", payload: { total: 200 } },
        ]);
        await persistence.save("Account", "1", [
          { name: "AccountCreated", payload: { owner: "Bob" } },
        ]);

        const orderEvents = await persistence.load("Order", "1");
        const accountEvents = await persistence.load("Account", "1");

        expect(orderEvents).toHaveLength(1);
        expect(orderEvents[0]!.name).toBe("OrderPlaced");
        expect(accountEvents).toHaveLength(1);
        expect(accountEvents[0]!.name).toBe("AccountCreated");
      });
    }

    describe("InMemoryEventSourcedAggregatePersistence", () => {
      runContractTests(() => new InMemoryEventSourcedAggregatePersistence());
    });
  });

  // ### SagaPersistence contract: save, load, and not-found semantics
  describe("SagaPersistence contract", () => {
    function runContractTests(createPersistence: () => SagaPersistence) {
      it("should return the saved state on load", async () => {
        const persistence = createPersistence();
        const state = { status: "awaiting_payment" };

        await persistence.save("OrderFulfillment", "order-1", state);
        const loaded = await persistence.load("OrderFulfillment", "order-1");

        expect(loaded).toEqual(state);
      });

      it("should return null or undefined for unknown saga instance", async () => {
        const persistence = createPersistence();
        const loaded = await persistence.load(
          "OrderFulfillment",
          "nonexistent",
        );

        expect(loaded == null).toBe(true);
      });

      it("should overwrite state on repeated saves", async () => {
        const persistence = createPersistence();

        await persistence.save("OrderFulfillment", "o-1", { step: 1 });
        await persistence.save("OrderFulfillment", "o-1", { step: 2 });

        const loaded = await persistence.load("OrderFulfillment", "o-1");
        expect(loaded).toEqual({ step: 2 });
      });

      it("should isolate by saga name", async () => {
        const persistence = createPersistence();

        await persistence.save("OrderFulfillment", "1", { a: true });
        await persistence.save("PaymentFlow", "1", { b: true });

        expect(await persistence.load("OrderFulfillment", "1")).toEqual({
          a: true,
        });
        expect(await persistence.load("PaymentFlow", "1")).toEqual({
          b: true,
        });
      });
    }

    describe("InMemorySagaPersistence", () => {
      runContractTests(() => new InMemorySagaPersistence());
    });
  });
});
