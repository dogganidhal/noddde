import { describe, it, expect } from "vitest";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
} from "@noddde/engine";

describe("InMemoryEventSourcedAggregatePersistence", () => {
  it("save and load round-trip", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    const events = [
      { name: "AccountCreated", payload: { id: "acc-1", owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 100 } },
    ];

    await persistence.save("BankAccount", "acc-1", events, 0);

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

    await persistence.save(
      "BankAccount",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );
    await persistence.save(
      "BankAccount",
      "acc-1",
      [
        { name: "DepositMade", payload: { amount: 50 } },
        { name: "DepositMade", payload: { amount: 75 } },
      ],
      1,
    );

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
    expect(orderEvents[0]?.name).toBe("OrderPlaced");

    expect(accountEvents).toHaveLength(1);
    expect(accountEvents[0]?.name).toBe("AccountCreated");
  });

  it("saving empty array is a no-op", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "BankAccount",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );
    await persistence.save("BankAccount", "acc-1", [], 1);

    const loaded = await persistence.load("BankAccount", "acc-1");
    expect(loaded).toHaveLength(1);
  });

  it("loadAfterVersion returns events after the given version", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "BankAccount",
      "acc-1",
      [
        { name: "AccountCreated", payload: { id: "acc-1" } },
        { name: "DepositMade", payload: { amount: 50 } },
        { name: "DepositMade", payload: { amount: 75 } },
      ],
      0,
    );

    const events = await persistence.loadAfterVersion(
      "BankAccount",
      "acc-1",
      1,
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ name: "DepositMade", payload: { amount: 50 } });
    expect(events[1]).toEqual({
      name: "DepositMade",
      payload: { amount: 75 },
    });
  });

  it("loadAfterVersion returns all events when afterVersion is 0", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "BankAccount",
      "acc-1",
      [
        { name: "AccountCreated", payload: { id: "acc-1" } },
        { name: "DepositMade", payload: { amount: 50 } },
      ],
      0,
    );

    const events = await persistence.loadAfterVersion(
      "BankAccount",
      "acc-1",
      0,
    );

    expect(events).toHaveLength(2);
  });

  it("loadAfterVersion returns empty array when afterVersion >= stream length", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "BankAccount",
      "acc-1",
      [{ name: "AccountCreated", payload: { id: "acc-1" } }],
      0,
    );

    const events = await persistence.loadAfterVersion(
      "BankAccount",
      "acc-1",
      5,
    );

    expect(events).toEqual([]);
  });
});

describe("InMemoryStateStoredAggregatePersistence", () => {
  it("save and load round-trip", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const state = { id: "acc-1", balance: 250, owner: "Alice" };
    await persistence.save("BankAccount", "acc-1", state, 0);

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toEqual({ state, version: 1 });
  });

  it("load returns undefined for unknown aggregate", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    const state = await persistence.load("BankAccount", "nonexistent");

    expect(state == null).toBe(true);
  });

  it("save overwrites previous state", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("BankAccount", "acc-1", { balance: 100 }, 0);
    await persistence.save("BankAccount", "acc-1", { balance: 250 }, 1);

    const loaded = await persistence.load("BankAccount", "acc-1");

    expect(loaded).toEqual({ state: { balance: 250 }, version: 2 });
  });

  it("namespace isolation between aggregate types", async () => {
    const persistence = new InMemoryStateStoredAggregatePersistence();

    await persistence.save("Order", "1", { status: "placed" }, 0);
    await persistence.save("Account", "1", { balance: 500 }, 0);

    const orderState = await persistence.load("Order", "1");
    const accountState = await persistence.load("Account", "1");

    expect(orderState).toEqual({ state: { status: "placed" }, version: 1 });
    expect(accountState).toEqual({ state: { balance: 500 }, version: 1 });
  });
});

describe("InMemoryEventSourcedAggregatePersistence.read", () => {
  it("should yield every persisted event in insertion order", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { id: "acc-1" } },
        { name: "DepositMade", payload: { amount: 50 } },
      ],
      0,
    );
    await persistence.save(
      "Account",
      "acc-2",
      [
        { name: "AccountCreated", payload: { id: "acc-2" } },
        { name: "DepositMade", payload: { amount: 75 } },
      ],
      0,
    );

    const collected: string[] = [];
    for await (const event of persistence.read()) {
      collected.push(event.name);
    }

    expect(collected).toEqual([
      "AccountCreated",
      "DepositMade",
      "AccountCreated",
      "DepositMade",
    ]);
  });
});

describe("InMemoryEventSourcedAggregatePersistence.read aggregateName filter", () => {
  it("should yield only events from aggregates matching the filter", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    await persistence.save(
      "Order",
      "o-1",
      [{ name: "OrderPlaced", payload: { id: "o-1" } }],
      0,
    );
    await persistence.save(
      "Account",
      "a-1",
      [{ name: "AccountCreated", payload: { id: "a-1" } }],
      0,
    );

    const names: string[] = [];
    for await (const event of persistence.read({ aggregateName: "Order" })) {
      names.push(event.name);
    }

    expect(names).toEqual(["OrderPlaced"]);
  });
});

describe("InMemoryEventSourcedAggregatePersistence.read empty store", () => {
  it("should produce an iterable that immediately terminates", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();

    let count = 0;
    // eslint-disable-next-line no-unused-vars
    for await (const _ of persistence.read()) count++;
    expect(count).toBe(0);
  });
});

describe("InMemoryEventSourcedAggregatePersistence.read after cursor", () => {
  it("should throw when an after cursor is provided", async () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    await persistence.save(
      "Order",
      "o-1",
      [{ name: "OrderPlaced", payload: {} }],
      0,
    );

    const iterator = persistence
      .read({
        after: { aggregateName: "Order", aggregateId: "o-1", version: 0 },
      })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow(
      /'after' cursor is not supported/,
    );
  });
});

describe("InMemoryEventSourcedAggregatePersistence EventReader shape", () => {
  it("should expose a callable read() method (duck-typed EventReader)", () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    expect(typeof (persistence as { read?: unknown }).read).toBe("function");
  });
});
