import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { ConcurrencyError } from "@noddde/core";
import { createDrizzlePersistence } from "../index";
import { createDrizzleAdapter } from "../builder";
import {
  events,
  aggregateStates,
  sagaStates,
  snapshots,
  outbox,
} from "../sqlite/schema";

// Custom per-aggregate table with convention-based columns
const ordersTable = sqliteTable("orders", {
  aggregateId: text("aggregate_id").notNull().primaryKey(),
  state: text("state").notNull(),
  version: integer("version").notNull().default(0),
});

// Custom per-aggregate table with non-standard column names
const customOrdersTable = sqliteTable("custom_orders", {
  id: text("id").notNull().primaryKey(),
  data: text("data").notNull(),
  ver: integer("ver").notNull().default(0),
});

// Table with wrong columns (for convention resolution failure test)
const badTable = sqliteTable("bad_table", {
  foo: text("foo").notNull(),
  bar: integer("bar").notNull(),
});

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
      metadata TEXT,
      created_at TEXT NOT NULL
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
    CREATE TABLE noddde_outbox (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      aggregate_name TEXT,
      aggregate_id TEXT,
      created_at TEXT NOT NULL,
      published_at TEXT
    );
  `);
  return drizzle(sqlite);
}

function createTestDbWithCustomTables() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE noddde_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aggregate_name TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX noddde_events_stream_version_idx
      ON noddde_events (aggregate_name, aggregate_id, sequence_number);
    CREATE TABLE noddde_saga_states (
      saga_name TEXT NOT NULL,
      saga_id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (saga_name, saga_id)
    );
    CREATE TABLE orders (
      aggregate_id TEXT NOT NULL PRIMARY KEY,
      state TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0
    );
  `);
  return drizzle(sqlite);
}

describe("createDrizzleAdapter", () => {
  it("creates all stores when fully configured", () => {
    const db = createTestDb();
    const result = createDrizzleAdapter(db, {
      eventStore: events,
      stateStore: aggregateStates,
      sagaStore: sagaStates,
      snapshotStore: snapshots,
      outboxStore: outbox,
      aggregateStates: { Order: { table: ordersTable } },
    });

    expect(result.eventSourcedPersistence).toBeDefined();
    expect(result.stateStoredPersistence).toBeDefined();
    expect(result.sagaPersistence).toBeDefined();
    expect(result.unitOfWorkFactory).toBeDefined();
    expect(result.snapshotStore).toBeDefined();
    expect(result.outboxStore).toBeDefined();
    expect(typeof result.stateStoreFor).toBe("function");
  });

  it("stateStoredPersistence absent when stateStore not in config", () => {
    const db = createTestDb();
    const result = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
    });

    expect((result as any).stateStoredPersistence).toBeUndefined();
    expect((result as any).snapshotStore).toBeUndefined();
    expect((result as any).outboxStore).toBeUndefined();
  });

  it("createDrizzlePersistence continues to work unchanged (backwards compat)", async () => {
    const db = createTestDb();
    const infra = createDrizzlePersistence(db, {
      events,
      aggregateStates,
      sagaStates,
    });

    await infra.eventSourcedPersistence.save(
      "Order",
      "o1",
      [{ name: "OrderPlaced", payload: { total: 100 } }],
      0,
    );
    const loaded = await infra.eventSourcedPersistence.load("Order", "o1");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.name).toBe("OrderPlaced");
  });
});

describe("Per-Aggregate State Table", () => {
  it("save and load roundtrip", async () => {
    const db = createTestDbWithCustomTables();
    const result = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: { Order: { table: ordersTable } },
    });

    const orderPersistence = result.stateStoreFor("Order");
    await orderPersistence.save(
      "Order",
      "order-1",
      { status: "placed", total: 100 },
      0,
    );

    const loaded = await orderPersistence.load("Order", "order-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual({ status: "placed", total: 100 });
    expect(loaded!.version).toBe(1);
  });

  it("returns null for nonexistent aggregate", async () => {
    const db = createTestDbWithCustomTables();
    const result = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: { Order: { table: ordersTable } },
    });

    const loaded = await result
      .stateStoreFor("Order")
      .load("Order", "nonexistent");
    expect(loaded).toBeNull();
  });

  it("throws ConcurrencyError on version mismatch", async () => {
    const db = createTestDbWithCustomTables();
    const result = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: { Order: { table: ordersTable } },
    });

    const persistence = result.stateStoreFor("Order");
    await persistence.save("Order", "order-1", { status: "placed" }, 0);

    await expect(
      persistence.save("Order", "order-1", { status: "confirmed" }, 0),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("uses custom column mapping", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE noddde_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        aggregate_name TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        event_name TEXT NOT NULL,
        payload TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX noddde_events_stream_version_idx
        ON noddde_events (aggregate_name, aggregate_id, sequence_number);
      CREATE TABLE noddde_saga_states (
        saga_name TEXT NOT NULL,
        saga_id TEXT NOT NULL,
        state TEXT NOT NULL,
        PRIMARY KEY (saga_name, saga_id)
      );
      CREATE TABLE custom_orders (
        id TEXT NOT NULL PRIMARY KEY,
        data TEXT NOT NULL,
        ver INTEGER NOT NULL DEFAULT 0
      );
    `);
    const db = drizzle(sqlite);

    const result = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: {
        Order: {
          table: customOrdersTable,
          columns: {
            aggregateId: customOrdersTable.id,
            state: customOrdersTable.data,
            version: customOrdersTable.ver,
          },
        },
      },
    });

    const persistence = result.stateStoreFor("Order");
    await persistence.save("Order", "order-1", { status: "placed" }, 0);

    const loaded = await persistence.load("Order", "order-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual({ status: "placed" });
    expect(loaded!.version).toBe(1);
  });

  it("stateStoreFor throws for unconfigured aggregate", () => {
    const db = createTestDbWithCustomTables();
    const result = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: { Order: { table: ordersTable } },
    });

    expect(() => (result as any).stateStoreFor("Payment")).toThrow(
      'No dedicated state table configured for aggregate "Payment"',
    );
  });

  it("participates in UoW transaction", async () => {
    const db = createTestDbWithCustomTables();
    const result = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: { Order: { table: ordersTable } },
    });

    const orderPersistence = result.stateStoreFor("Order");
    const uow = result.unitOfWorkFactory();

    uow.enlist(async () => {
      await result.eventSourcedPersistence.save(
        "Payment",
        "p1",
        [{ name: "PaymentReceived", payload: { amount: 50 } }],
        0,
      );
    });
    uow.enlist(async () => {
      await orderPersistence.save("Order", "order-1", { status: "paid" }, 0);
    });

    await uow.commit();

    const paymentEvents = await result.eventSourcedPersistence.load(
      "Payment",
      "p1",
    );
    expect(paymentEvents).toHaveLength(1);

    const orderState = await orderPersistence.load("Order", "order-1");
    expect(orderState).not.toBeNull();
    expect(orderState!.state).toEqual({ status: "paid" });
  });

  it("throws clear error when convention resolution fails", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(
      `CREATE TABLE bad_table (foo TEXT NOT NULL, bar INTEGER NOT NULL);`,
    );
    const db = drizzle(sqlite);

    expect(() =>
      createDrizzleAdapter(db, {
        eventStore: events,
        sagaStore: sagaStates,
        aggregateStates: { Bad: { table: badTable } },
      }),
    ).toThrow(/aggregate_id.*state.*version/);
  });
});
