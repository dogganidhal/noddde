import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ConcurrencyError } from "@noddde/core";
import type { PartialEventLoad } from "@noddde/core";
import { createDrizzlePersistence } from "../index";
import {
  events,
  aggregateStates,
  sagaStates,
  snapshots,
} from "../sqlite/schema";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE noddde_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      metadata TEXT
    );
    CREATE UNIQUE INDEX noddde_events_stream_version_idx
      ON noddde_events (aggregate_name, aggregate_id, sequence_number);
    CREATE TABLE noddde_aggregate_states (
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (aggregate_name, aggregate_id)
    );
    CREATE TABLE noddde_saga_states (
      saga_name TEXT NOT NULL,
      saga_id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (saga_name, saga_id)
    );
    CREATE TABLE noddde_snapshots (
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL,
      PRIMARY KEY (aggregate_name, aggregate_id)
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

    await persistence.save(
      "Order",
      "order-1",
      [
        { name: "OrderPlaced", payload: { total: 100 } },
        { name: "OrderConfirmed", payload: { confirmedAt: "2024-01-01" } },
      ],
      0,
    );

    const loaded = await persistence.load("Order", "order-1");
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual({
      name: "OrderPlaced",
      payload: JSON.stringify({ total: 100 }),
    });
    expect(loaded[1]).toEqual({
      name: "OrderConfirmed",
      payload: JSON.stringify({ confirmedAt: "2024-01-01" }),
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

    await persistence.save(
      "Order",
      "order-1",
      [{ name: "OrderPlaced", payload: {} }],
      0,
    );
    await persistence.save(
      "Order",
      "order-1",
      [{ name: "OrderConfirmed", payload: {} }],
      1,
    );

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

    await persistence.save(
      "Order",
      "id-1",
      [{ name: "OrderPlaced", payload: {} }],
      0,
    );
    await persistence.save(
      "Payment",
      "id-1",
      [{ name: "PaymentReceived", payload: {} }],
      0,
    );

    const orderEvents = await persistence.load("Order", "id-1");
    const paymentEvents = await persistence.load("Payment", "id-1");

    expect(orderEvents).toHaveLength(1);
    expect(orderEvents[0]!.name).toBe("OrderPlaced");
    expect(paymentEvents).toHaveLength(1);
    expect(paymentEvents[0]!.name).toBe("PaymentReceived");
  });

  it("throws ConcurrencyError on event-sourced version conflict", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const persistence = infra.eventSourcedPersistence;

    await persistence.save(
      "Order",
      "order-1",
      [{ name: "OrderPlaced", payload: {} }],
      0,
    );

    // Attempt to save with stale version (0 instead of 1)
    await expect(
      persistence.save(
        "Order",
        "order-1",
        [{ name: "OrderConfirmed", payload: {} }],
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("saves and loads state with JSON parsing and version", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const persistence = infra.stateStoredPersistence;

    await persistence.save(
      "Account",
      "acc-1",
      { balance: 500, owner: "Alice" },
      0,
    );
    const result = await persistence.load("Account", "acc-1");
    expect(result).toEqual({
      state: { balance: 500, owner: "Alice" },
      version: 1,
    });
  });

  it("returns null for nonexistent state-stored aggregate", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });

    const result = await infra.stateStoredPersistence.load(
      "Account",
      "nonexistent",
    );
    expect(result).toBeNull();
  });

  it("overwrites state on subsequent saves with version increments", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const persistence = infra.stateStoredPersistence;

    await persistence.save("Account", "acc-1", { balance: 100 }, 0);
    await persistence.save("Account", "acc-1", { balance: 200 }, 1);

    const result = await persistence.load("Account", "acc-1");
    expect(result).toEqual({ state: { balance: 200 }, version: 2 });
  });

  it("throws ConcurrencyError on state-stored version conflict", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });
    const persistence = infra.stateStoredPersistence;

    await persistence.save("Account", "acc-1", { balance: 100 }, 0);

    // Attempt to save with stale version (0 instead of 1)
    await expect(
      persistence.save("Account", "acc-1", { balance: 200 }, 0),
    ).rejects.toThrow(ConcurrencyError);
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
      await infra.eventSourcedPersistence.save(
        "Order",
        "o1",
        [{ name: "OrderPlaced", payload: { total: 50 } }],
        0,
      );
    });
    uow.enlist(async () => {
      await infra.stateStoredPersistence.save(
        "Account",
        "a1",
        { balance: 50 },
        0,
      );
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
    expect(loadedState).toEqual({ state: { balance: 50 }, version: 1 });
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
      await infra.eventSourcedPersistence.save(
        "Order",
        "o1",
        [{ name: "OrderPlaced", payload: {} }],
        0,
      );
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

  it("snapshot store: save and load roundtrip", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
      snapshots,
    });

    expect(infra.snapshotStore).toBeDefined();
    const store = infra.snapshotStore!;

    await store.save("Order", "order-1", {
      state: { status: "confirmed", total: 100 },
      version: 5,
    });

    const loaded = await store.load("Order", "order-1");
    expect(loaded).toEqual({
      state: { status: "confirmed", total: 100 },
      version: 5,
    });
  });

  it("snapshot store: returns null for unknown aggregate", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
      snapshots,
    });

    const loaded = await infra.snapshotStore!.load("Order", "nonexistent");
    expect(loaded).toBeNull();
  });

  it("snapshot store: overwrites on repeated saves", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
      snapshots,
    });
    const store = infra.snapshotStore!;

    await store.save("Order", "order-1", {
      state: { status: "placed" },
      version: 1,
    });
    await store.save("Order", "order-1", {
      state: { status: "confirmed" },
      version: 3,
    });

    const loaded = await store.load("Order", "order-1");
    expect(loaded).toEqual({
      state: { status: "confirmed" },
      version: 3,
    });
  });

  it("snapshotStore is not present when schema.snapshots is not provided", () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });

    expect(infra.snapshotStore).toBeUndefined();
  });

  it("loadAfterVersion: returns events after given version", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
      snapshots,
    });
    const persistence =
      infra.eventSourcedPersistence as typeof infra.eventSourcedPersistence &
        PartialEventLoad;

    await persistence.save(
      "Order",
      "order-1",
      [
        { name: "OrderPlaced", payload: { total: 100 } },
        { name: "OrderConfirmed", payload: {} },
        { name: "OrderShipped", payload: { trackingId: "T1" } },
      ],
      0,
    );

    const afterV1 = await persistence.loadAfterVersion("Order", "order-1", 1);
    expect(afterV1).toHaveLength(2);
    expect(afterV1[0]!.name).toBe("OrderConfirmed");
    expect(afterV1[1]!.name).toBe("OrderShipped");

    const afterV2 = await persistence.loadAfterVersion("Order", "order-1", 2);
    expect(afterV2).toHaveLength(1);
    expect(afterV2[0]!.name).toBe("OrderShipped");
  });

  it("loadAfterVersion: returns empty array when afterVersion >= stream length", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
      snapshots,
    });
    const persistence =
      infra.eventSourcedPersistence as typeof infra.eventSourcedPersistence &
        PartialEventLoad;

    await persistence.save(
      "Order",
      "order-1",
      [
        { name: "OrderPlaced", payload: {} },
        { name: "OrderConfirmed", payload: {} },
      ],
      0,
    );

    const afterV2 = await persistence.loadAfterVersion("Order", "order-1", 2);
    expect(afterV2).toEqual([]);

    const afterV10 = await persistence.loadAfterVersion("Order", "order-1", 10);
    expect(afterV10).toEqual([]);
  });

  it("loadAfterVersion: returns all events when afterVersion is 0", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
      snapshots,
    });
    const persistence =
      infra.eventSourcedPersistence as typeof infra.eventSourcedPersistence &
        PartialEventLoad;

    await persistence.save(
      "Order",
      "order-1",
      [
        { name: "OrderPlaced", payload: {} },
        { name: "OrderConfirmed", payload: {} },
      ],
      0,
    );

    const all = await persistence.loadAfterVersion("Order", "order-1", 0);
    expect(all).toHaveLength(2);
    expect(all[0]!.name).toBe("OrderPlaced");
    expect(all[1]!.name).toBe("OrderConfirmed");
  });
});
