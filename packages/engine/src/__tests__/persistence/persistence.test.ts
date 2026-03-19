import { describe, it, expect } from "vitest";
import type {
  StateStoredAggregatePersistence,
  EventSourcedAggregatePersistence,
  SagaPersistence,
} from "@noddde/core";
import { ConcurrencyError, LockTimeoutError, fnv1a64 } from "@noddde/core";
import {
  InMemoryStateStoredAggregatePersistence,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySagaPersistence,
} from "@noddde/engine";

// ═══════════════════════════════════════════════════════════════════
// StateStoredAggregatePersistence contract: save then load returns the state
// ═══════════════════════════════════════════════════════════════════

describe("StateStoredAggregatePersistence contract", () => {
  function runContractTests(
    createPersistence: () => StateStoredAggregatePersistence,
  ) {
    it("should return the saved state and version on load", async () => {
      const persistence = createPersistence();
      const state = { balance: 100, owner: "Alice" };

      await persistence.save("BankAccount", "acc-1", state, 0);
      const loaded = await persistence.load("BankAccount", "acc-1");

      expect(loaded).toEqual({ state, version: 1 });
    });

    it("should return null for an unknown aggregate", async () => {
      const persistence = createPersistence();
      const loaded = await persistence.load("BankAccount", "nonexistent");

      expect(loaded).toBeNull();
    });

    it("should overwrite state on repeated saves with correct versions", async () => {
      const persistence = createPersistence();

      await persistence.save("BankAccount", "acc-1", { balance: 100 }, 0);
      await persistence.save("BankAccount", "acc-1", { balance: 200 }, 1);
      const loaded = await persistence.load("BankAccount", "acc-1");

      expect(loaded).toEqual({ state: { balance: 200 }, version: 2 });
    });

    it("should isolate by aggregate name", async () => {
      const persistence = createPersistence();

      await persistence.save("Order", "1", { total: 50 }, 0);
      await persistence.save("Account", "1", { balance: 999 }, 0);

      const order = await persistence.load("Order", "1");
      const account = await persistence.load("Account", "1");

      expect(order).toEqual({ state: { total: 50 }, version: 1 });
      expect(account).toEqual({ state: { balance: 999 }, version: 1 });
    });
  }

  describe("InMemoryStateStoredAggregatePersistence", () => {
    runContractTests(() => new InMemoryStateStoredAggregatePersistence());
  });
});

// ═══════════════════════════════════════════════════════════════════
// EventSourcedAggregatePersistence contract: append and replay
// ═══════════════════════════════════════════════════════════════════

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

      await persistence.save("BankAccount", "acc-1", events, 0);
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

      await persistence.save(
        "BankAccount",
        "acc-1",
        [{ name: "AccountCreated", payload: { id: "acc-1" } }],
        0,
      );
      await persistence.save(
        "BankAccount",
        "acc-1",
        [{ name: "DepositMade", payload: { amount: 50 } }],
        1,
      );

      const loaded = await persistence.load("BankAccount", "acc-1");

      expect(loaded).toHaveLength(2);
      expect(loaded[0]!.name).toBe("AccountCreated");
      expect(loaded[1]!.name).toBe("DepositMade");
    });

    it("should isolate by aggregate name", async () => {
      const persistence = createPersistence();

      await persistence.save(
        "Order",
        "1",
        [{ name: "OrderPlaced", payload: { total: 200 } }],
        0,
      );
      await persistence.save(
        "Account",
        "1",
        [{ name: "AccountCreated", payload: { owner: "Bob" } }],
        0,
      );

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

// ═══════════════════════════════════════════════════════════════════
// ConcurrencyError: event-sourced save throws on version mismatch
// ═══════════════════════════════════════════════════════════════════

describe("EventSourcedAggregatePersistence concurrency", () => {
  it("should throw ConcurrencyError when expectedVersion does not match stream length", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );

    // Attempt to save with stale version (0 instead of 1)
    await expect(
      persistence.save(
        "Account",
        "acc-1",
        [{ name: "DepositMade", payload: { amount: 50 } }],
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);

    // Verify the error properties
    try {
      await persistence.save(
        "Account",
        "acc-1",
        [{ name: "DepositMade", payload: { amount: 50 } }],
        0,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ConcurrencyError);
      const concurrencyError = error as ConcurrencyError;
      expect(concurrencyError.aggregateName).toBe("Account");
      expect(concurrencyError.aggregateId).toBe("acc-1");
      expect(concurrencyError.expectedVersion).toBe(0);
      expect(concurrencyError.actualVersion).toBe(1);
    }
  });

  it("should succeed when expectedVersion matches stream length", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );

    // Save with correct version
    await persistence.save(
      "Account",
      "acc-1",
      [{ name: "DepositMade", payload: { amount: 50 } }],
      1,
    );

    const loaded = await persistence.load("Account", "acc-1");
    expect(loaded).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ConcurrencyError: state-stored save throws on version mismatch
// ═══════════════════════════════════════════════════════════════════

describe("StateStoredAggregatePersistence concurrency", () => {
  it("should throw ConcurrencyError when expectedVersion does not match stored version", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("Account", "acc-1", { balance: 100 }, 0);

    // Attempt to save with stale version (0 instead of 1)
    await expect(
      persistence.save("Account", "acc-1", { balance: 200 }, 0),
    ).rejects.toThrow(ConcurrencyError);

    // Verify the error properties
    try {
      await persistence.save("Account", "acc-1", { balance: 200 }, 0);
    } catch (error) {
      expect(error).toBeInstanceOf(ConcurrencyError);
      const concurrencyError = error as ConcurrencyError;
      expect(concurrencyError.aggregateName).toBe("Account");
      expect(concurrencyError.aggregateId).toBe("acc-1");
      expect(concurrencyError.expectedVersion).toBe(0);
      expect(concurrencyError.actualVersion).toBe(1);
    }
  });

  it("should succeed when expectedVersion matches stored version", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("Account", "acc-1", { balance: 100 }, 0);
    await persistence.save("Account", "acc-1", { balance: 200 }, 1);

    const loaded = await persistence.load("Account", "acc-1");
    expect(loaded).toEqual({ state: { balance: 200 }, version: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// SagaPersistence contract: save, load, and not-found semantics
// ═══════════════════════════════════════════════════════════════════

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
      const loaded = await persistence.load("OrderFulfillment", "nonexistent");

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
      expect(await persistence.load("PaymentFlow", "1")).toEqual({ b: true });
    });
  }

  describe("InMemorySagaPersistence", () => {
    runContractTests(() => new InMemorySagaPersistence());
  });
});

// ═══════════════════════════════════════════════════════════════════
// fnv1a64: deterministic hash output
// ═══════════════════════════════════════════════════════════════════

describe("fnv1a64", () => {
  it("should produce the same hash for the same input", () => {
    const hash1 = fnv1a64("BankAccount:acc-1");
    const hash2 = fnv1a64("BankAccount:acc-1");
    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different inputs", () => {
    const hash1 = fnv1a64("BankAccount:acc-1");
    const hash2 = fnv1a64("BankAccount:acc-2");
    expect(hash1).not.toBe(hash2);
  });

  it("should return a bigint", () => {
    const hash = fnv1a64("test");
    expect(typeof hash).toBe("bigint");
  });
});

// ═══════════════════════════════════════════════════════════════════
// LockTimeoutError: properties and inheritance
// ═══════════════════════════════════════════════════════════════════

describe("LockTimeoutError", () => {
  it("should have correct name, message, and properties", () => {
    const error = new LockTimeoutError("Account", "acc-1", 5000);
    expect(error.name).toBe("LockTimeoutError");
    expect(error.aggregateName).toBe("Account");
    expect(error.aggregateId).toBe("acc-1");
    expect(error.timeoutMs).toBe(5000);
    expect(error.message).toContain("Account:acc-1");
    expect(error.message).toContain("5000");
  });

  it("should be an instance of Error", () => {
    const error = new LockTimeoutError("Account", "acc-1", 5000);
    expect(error).toBeInstanceOf(Error);
  });

  it("should NOT be an instance of ConcurrencyError", () => {
    const error = new LockTimeoutError("Account", "acc-1", 5000);
    expect(error).not.toBeInstanceOf(ConcurrencyError);
  });
});
