import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createDrizzlePersistence } from "../index";
import { events, aggregateStates, sagaStates } from "../sqlite/schema";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE noddde_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE noddde_aggregate_states (
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (aggregate_name, aggregate_id)
    );
    CREATE TABLE noddde_saga_states (
      saga_name TEXT NOT NULL,
      saga_id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (saga_name, saga_id)
    );
  `);
  return drizzle(sqlite);
}

describe("Drizzle Multi-Dialect Persistence", () => {
  it("factory creates all four infrastructure components", () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });

    expect(infra.eventSourcedPersistence).toBeDefined();
    expect(infra.stateStoredPersistence).toBeDefined();
    expect(infra.sagaPersistence).toBeDefined();
    expect(infra.unitOfWorkFactory).toBeDefined();
    expect(typeof infra.unitOfWorkFactory).toBe("function");
  });

  it("saves and loads events with JSON-parsed payloads", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const persistence = infra.eventSourcedPersistence;

    await persistence.save("Order", "order-1", [
      { name: "OrderPlaced", payload: { total: 100 } },
      { name: "OrderConfirmed", payload: { confirmedAt: "2024-01-01" } },
    ]);

    const loaded = await persistence.load("Order", "order-1");
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual({
      name: "OrderPlaced",
      payload: { total: 100 },
    });
    expect(loaded[1]).toEqual({
      name: "OrderConfirmed",
      payload: { confirmedAt: "2024-01-01" },
    });
  });

  it("returns empty array for nonexistent aggregate", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });

    const loaded = await infra.eventSourcedPersistence.load(
      "Order",
      "nonexistent",
    );
    expect(loaded).toEqual([]);
  });

  it("appends events with incrementing sequence numbers", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const persistence = infra.eventSourcedPersistence;

    await persistence.save("Order", "order-1", [
      { name: "OrderPlaced", payload: {} },
    ]);
    await persistence.save("Order", "order-1", [
      { name: "OrderConfirmed", payload: {} },
    ]);

    const loaded = await persistence.load("Order", "order-1");
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.name).toBe("OrderPlaced");
    expect(loaded[1]!.name).toBe("OrderConfirmed");
  });

  it("isolates events by aggregate name", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const persistence = infra.eventSourcedPersistence;

    await persistence.save("Order", "id-1", [
      { name: "OrderPlaced", payload: {} },
    ]);
    await persistence.save("Payment", "id-1", [
      { name: "PaymentReceived", payload: {} },
    ]);

    const orderEvents = await persistence.load("Order", "id-1");
    const paymentEvents = await persistence.load("Payment", "id-1");

    expect(orderEvents).toHaveLength(1);
    expect(orderEvents[0]!.name).toBe("OrderPlaced");
    expect(paymentEvents).toHaveLength(1);
    expect(paymentEvents[0]!.name).toBe("PaymentReceived");
  });

  it("saves and loads state with JSON parsing", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const persistence = infra.stateStoredPersistence;

    await persistence.save("Account", "acc-1", {
      balance: 500,
      owner: "Alice",
    });
    const state = await persistence.load("Account", "acc-1");
    expect(state).toEqual({ balance: 500, owner: "Alice" });
  });

  it("returns undefined for nonexistent state-stored aggregate", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });

    const state = await infra.stateStoredPersistence.load(
      "Account",
      "nonexistent",
    );
    expect(state).toBeUndefined();
  });

  it("overwrites state on subsequent saves", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const persistence = infra.stateStoredPersistence;

    await persistence.save("Account", "acc-1", { balance: 100 });
    await persistence.save("Account", "acc-1", { balance: 200 });

    const state = await persistence.load("Account", "acc-1");
    expect(state).toEqual({ balance: 200 });
  });

  it("saves and loads saga state", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const persistence = infra.sagaPersistence;

    await persistence.save("OrderSaga", "saga-1", {
      status: "active",
      step: 2,
    });
    const state = await persistence.load("OrderSaga", "saga-1");
    expect(state).toEqual({ status: "active", step: 2 });
  });

  it("commits all operations atomically and returns deferred events", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const uow = infra.unitOfWorkFactory();

    uow.enlist(async () => {
      await infra.eventSourcedPersistence.save("Order", "o1", [
        { name: "OrderPlaced", payload: { total: 50 } },
      ]);
    });
    uow.enlist(async () => {
      await infra.stateStoredPersistence.save("Account", "a1", {
        balance: 50,
      });
    });
    uow.deferPublish({ name: "OrderPlaced", payload: { total: 50 } });

    const publishedEvents = await uow.commit();

    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]!.name).toBe("OrderPlaced");

    const loadedEvents = await infra.eventSourcedPersistence.load(
      "Order",
      "o1",
    );
    expect(loadedEvents).toHaveLength(1);

    const loadedState = await infra.stateStoredPersistence.load(
      "Account",
      "a1",
    );
    expect(loadedState).toEqual({ balance: 50 });
  });

  it("rollback discards all operations and events", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const uow = infra.unitOfWorkFactory();

    uow.enlist(async () => {
      await infra.eventSourcedPersistence.save("Order", "o1", [
        { name: "OrderPlaced", payload: {} },
      ]);
    });
    uow.deferPublish({ name: "OrderPlaced", payload: {} });

    await uow.rollback();

    const loaded = await infra.eventSourcedPersistence.load("Order", "o1");
    expect(loaded).toEqual([]);
  });

  it("throws on any operation after commit or rollback", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const uow = infra.unitOfWorkFactory();

    await uow.commit();

    expect(() => uow.enlist(async () => {})).toThrow(
      "UnitOfWork already completed",
    );
    expect(() => uow.deferPublish()).toThrow("UnitOfWork already completed");
    await expect(uow.commit()).rejects.toThrow("UnitOfWork already completed");
    await expect(uow.rollback()).rejects.toThrow(
      "UnitOfWork already completed",
    );
  });
});
