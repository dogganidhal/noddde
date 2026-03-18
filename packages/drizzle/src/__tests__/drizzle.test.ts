import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { createDrizzlePersistence } from "../index";
import { nodddeEvents, nodddeAggregateStates, nodddeSagaStates } from "../schema";

function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite);

  // Create tables
  db.run(sql`CREATE TABLE noddde_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aggregate_name TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    event_name TEXT NOT NULL,
    payload TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE noddde_aggregate_states (
    aggregate_name TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    state TEXT NOT NULL,
    PRIMARY KEY (aggregate_name, aggregate_id)
  )`);

  db.run(sql`CREATE TABLE noddde_saga_states (
    saga_name TEXT NOT NULL,
    saga_id TEXT NOT NULL,
    state TEXT NOT NULL,
    PRIMARY KEY (saga_name, saga_id)
  )`);

  return db;
}

// ═══════════════════════════════════════════════════════════════════
// Event-Sourced Aggregate Persistence
// ═══════════════════════════════════════════════════════════════════

describe("DrizzleEventSourcedAggregatePersistence", () => {
  let infra: ReturnType<typeof createDrizzlePersistence>;

  beforeEach(() => {
    const db = createTestDb();
    infra = createDrizzlePersistence(db);
  });

  it("should save and load events", async () => {
    const { eventSourcedPersistence: persistence } = infra;

    await persistence.save("Account", "acc-1", [
      { name: "AccountCreated", payload: { owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 100 } },
    ]);

    const events = await persistence.load("Account", "acc-1");
    expect(events).toEqual([
      { name: "AccountCreated", payload: { owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 100 } },
    ]);
  });

  it("should return empty array for unknown aggregate", async () => {
    const events = await infra.eventSourcedPersistence.load("Account", "nonexistent");
    expect(events).toEqual([]);
  });

  it("should append events across multiple saves", async () => {
    const { eventSourcedPersistence: persistence } = infra;

    await persistence.save("Account", "acc-1", [
      { name: "AccountCreated", payload: { owner: "Alice" } },
    ]);
    await persistence.save("Account", "acc-1", [
      { name: "DepositMade", payload: { amount: 50 } },
    ]);

    const events = await persistence.load("Account", "acc-1");
    expect(events).toHaveLength(2);
    expect(events[0]!.name).toBe("AccountCreated");
    expect(events[1]!.name).toBe("DepositMade");
  });

  it("should isolate by aggregate name", async () => {
    const { eventSourcedPersistence: persistence } = infra;

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
});

// ═══════════════════════════════════════════════════════════════════
// State-Stored Aggregate Persistence
// ═══════════════════════════════════════════════════════════════════

describe("DrizzleStateStoredAggregatePersistence", () => {
  let infra: ReturnType<typeof createDrizzlePersistence>;

  beforeEach(() => {
    const db = createTestDb();
    infra = createDrizzlePersistence(db);
  });

  it("should save and load state", async () => {
    const { stateStoredPersistence: persistence } = infra;

    await persistence.save("Account", "acc-1", { balance: 100, owner: "Alice" });
    const state = await persistence.load("Account", "acc-1");
    expect(state).toEqual({ balance: 100, owner: "Alice" });
  });

  it("should return undefined for unknown aggregate", async () => {
    const state = await infra.stateStoredPersistence.load("Account", "nonexistent");
    expect(state).toBeUndefined();
  });

  it("should overwrite state on repeated saves", async () => {
    const { stateStoredPersistence: persistence } = infra;

    await persistence.save("Account", "acc-1", { balance: 100 });
    await persistence.save("Account", "acc-1", { balance: 200 });
    const state = await persistence.load("Account", "acc-1");
    expect(state).toEqual({ balance: 200 });
  });

  it("should isolate by aggregate name", async () => {
    const { stateStoredPersistence: persistence } = infra;

    await persistence.save("Order", "1", { total: 50 });
    await persistence.save("Account", "1", { balance: 999 });

    expect(await persistence.load("Order", "1")).toEqual({ total: 50 });
    expect(await persistence.load("Account", "1")).toEqual({ balance: 999 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Saga Persistence
// ═══════════════════════════════════════════════════════════════════

describe("DrizzleSagaPersistence", () => {
  let infra: ReturnType<typeof createDrizzlePersistence>;

  beforeEach(() => {
    const db = createTestDb();
    infra = createDrizzlePersistence(db);
  });

  it("should save and load saga state", async () => {
    const { sagaPersistence: persistence } = infra;

    await persistence.save("Fulfillment", "order-1", { status: "awaiting_payment" });
    const state = await persistence.load("Fulfillment", "order-1");
    expect(state).toEqual({ status: "awaiting_payment" });
  });

  it("should return undefined for unknown saga", async () => {
    const state = await infra.sagaPersistence.load("Fulfillment", "nonexistent");
    expect(state == null).toBe(true);
  });

  it("should overwrite state on repeated saves", async () => {
    const { sagaPersistence: persistence } = infra;

    await persistence.save("Fulfillment", "o-1", { step: 1 });
    await persistence.save("Fulfillment", "o-1", { step: 2 });
    const state = await persistence.load("Fulfillment", "o-1");
    expect(state).toEqual({ step: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// UnitOfWork (real database transaction)
// ═══════════════════════════════════════════════════════════════════

describe("DrizzleUnitOfWork", () => {
  it("should commit all operations in a real database transaction", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db);

    const uow = infra.unitOfWorkFactory();

    uow.enlist(() =>
      infra.eventSourcedPersistence.save("Account", "acc-1", [
        { name: "AccountCreated", payload: { owner: "Alice" } },
      ]),
    );
    uow.enlist(() =>
      infra.sagaPersistence.save("Fulfillment", "o-1", { step: 1 }),
    );
    uow.deferPublish({ name: "AccountCreated", payload: { owner: "Alice" } });

    const events = await uow.commit();

    // Events returned for publishing
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe("AccountCreated");

    // Data is persisted
    const loaded = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(loaded).toHaveLength(1);
    const sagaState = await infra.sagaPersistence.load("Fulfillment", "o-1");
    expect(sagaState).toEqual({ step: 1 });
  });

  it("should rollback without persisting anything", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db);

    const uow = infra.unitOfWorkFactory();

    uow.enlist(() =>
      infra.eventSourcedPersistence.save("Account", "acc-1", [
        { name: "AccountCreated", payload: { owner: "Alice" } },
      ]),
    );

    await uow.rollback();

    const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(events).toEqual([]);
  });
});
