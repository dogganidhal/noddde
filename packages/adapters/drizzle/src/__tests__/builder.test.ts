import { describe, it, expect } from "vitest";
import { expectTypeOf } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { ConcurrencyError } from "@noddde/core";
import {
  createDrizzlePersistence,
  createDrizzleAdapter,
  jsonStateMapper,
  type DrizzleStateMapper,
  type AggregateStateTableConfig,
} from "../index";
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

// Typed-column table for custom mapper test
type OrderState = {
  customerId: string;
  total: number;
  status: "open" | "paid" | "cancelled";
};

const typedOrdersTable = sqliteTable("typed_orders", {
  aggregateId: text("aggregate_id").notNull().primaryKey(),
  customerId: text("customer_id").notNull(),
  total: integer("total_cents").notNull(),
  status: text("status").$type<OrderState["status"]>().notNull(),
  version: integer("version").notNull().default(0),
});

const orderMapper: DrizzleStateMapper<OrderState, typeof typedOrdersTable> = {
  aggregateIdColumn: typedOrdersTable.aggregateId,
  versionColumn: typedOrdersTable.version,
  toRow: (state) => ({
    customerId: state.customerId,
    total: state.total,
    status: state.status,
  }),
  fromRow: (row) => ({
    customerId: row.customerId!,
    total: row.total!,
    status: row.status!,
  }),
};

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
  it("factory creates all infrastructure components", () => {
    const db = createTestDb();
    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      stateStore: aggregateStates,
    });

    expect(adapter.eventSourcedPersistence).toBeDefined();
    expect(adapter.stateStoredPersistence).toBeDefined();
    expect(adapter.sagaPersistence).toBeDefined();
    expect(adapter.unitOfWorkFactory).toBeDefined();
    expect(typeof adapter.unitOfWorkFactory).toBe("function");
  });

  it("creates all stores with shared txStore", () => {
    const db = createTestDb();
    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      stateStore: aggregateStates,
      snapshotStore: snapshots,
      outboxStore: outbox,
      aggregateStates: {
        Order: {
          table: aggregateStates,
          mapper: jsonStateMapper(aggregateStates),
        },
      },
    });

    expect(adapter.eventSourcedPersistence).toBeDefined();
    expect(adapter.stateStoredPersistence).toBeDefined();
    expect(adapter.sagaPersistence).toBeDefined();
    expect(adapter.unitOfWorkFactory).toBeDefined();
    expect(adapter.snapshotStore).toBeDefined();
    expect(adapter.outboxStore).toBeDefined();
    expect(typeof adapter.stateStoreFor).toBe("function");
  });

  it("stateStoredPersistence is absent when stateStore not in config", () => {
    const db = createTestDb();
    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
    });

    // TypeScript: adapter.stateStoredPersistence does not exist on the type
    expect((adapter as any).stateStoredPersistence).toBeUndefined();
  });

  it("backwards compat: createDrizzlePersistence delegates to createDrizzleAdapter", async () => {
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
  it("per-aggregate state table: jsonStateMapper save and load roundtrip", async () => {
    const db = createTestDbWithCustomTables();
    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: {
        Order: { table: ordersTable, mapper: jsonStateMapper(ordersTable) },
      },
    });

    const orderPersistence = adapter.stateStoreFor("Order");
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

  it("per-aggregate state table: returns null for nonexistent", async () => {
    const db = createTestDbWithCustomTables();
    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: {
        Order: { table: ordersTable, mapper: jsonStateMapper(ordersTable) },
      },
    });

    const loaded = await adapter
      .stateStoreFor("Order")
      .load("Order", "nonexistent");
    expect(loaded).toBeNull();
  });

  it("per-aggregate state table: throws ConcurrencyError on version mismatch", async () => {
    const db = createTestDbWithCustomTables();
    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: {
        Order: { table: ordersTable, mapper: jsonStateMapper(ordersTable) },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save("Order", "order-1", { status: "placed" }, 0);

    // Try to save with wrong version
    await expect(
      persistence.save("Order", "order-1", { status: "confirmed" }, 0),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("per-aggregate state table: jsonStateMapper accepts column overrides", async () => {
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

    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: {
        Order: {
          table: customOrdersTable,
          mapper: jsonStateMapper(customOrdersTable, {
            aggregateIdColumn: customOrdersTable.id,
            stateColumn: customOrdersTable.data,
            versionColumn: customOrdersTable.ver,
          }),
        },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save("Order", "order-1", { status: "placed" }, 0);

    const loaded = await persistence.load("Order", "order-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual({ status: "placed" });
    expect(loaded!.version).toBe(1);
  });

  it("per-aggregate state table: typed-column mapper writes and reads typed rows", async () => {
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
      CREATE TABLE noddde_saga_states (
        saga_name TEXT NOT NULL,
        saga_id TEXT NOT NULL,
        state TEXT NOT NULL,
        PRIMARY KEY (saga_name, saga_id)
      );
      CREATE TABLE typed_orders (
        aggregate_id TEXT NOT NULL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        total_cents INTEGER NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0
      );
    `);
    const db = drizzle(sqlite);

    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: {
        Order: { table: typedOrdersTable, mapper: orderMapper },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save(
      "Order",
      "o-1",
      { customerId: "c-7", total: 4200, status: "open" },
      0,
    );

    // Verify the row landed in typed columns, not as JSON
    const raw = sqlite
      .prepare("SELECT * FROM typed_orders WHERE aggregate_id = ?")
      .get("o-1") as any;
    expect(raw.customer_id).toBe("c-7");
    expect(raw.total_cents).toBe(4200);
    expect(raw.status).toBe("open");
    expect(raw.version).toBe(1);

    const loaded = await persistence.load("Order", "o-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual({
      customerId: "c-7",
      total: 4200,
      status: "open",
    });
    expect(loaded!.version).toBe(1);
  });

  it("typed-column mapper: throws ConcurrencyError on version mismatch", async () => {
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
      CREATE TABLE noddde_saga_states (
        saga_name TEXT NOT NULL,
        saga_id TEXT NOT NULL,
        state TEXT NOT NULL,
        PRIMARY KEY (saga_name, saga_id)
      );
      CREATE TABLE typed_orders (
        aggregate_id TEXT NOT NULL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        total_cents INTEGER NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0
      );
    `);
    const db = drizzle(sqlite);

    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: {
        Order: { table: typedOrdersTable, mapper: orderMapper },
      },
    });

    const persistence = adapter.stateStoreFor("Order");
    await persistence.save(
      "Order",
      "o-1",
      { customerId: "c-7", total: 1000, status: "open" },
      0,
    );

    await expect(
      persistence.save(
        "Order",
        "o-1",
        { customerId: "c-7", total: 2000, status: "paid" },
        0,
      ),
    ).rejects.toThrow(ConcurrencyError);
  });

  it("typed-column mapper: TS rejects mappers with mismatched row keys", () => {
    // Compile-time only — ensures the mapper's toRow return type is constrained
    // to Partial<typeof typedOrdersTable.$inferInsert>.
    type Row = Partial<typeof typedOrdersTable.$inferInsert>;
    expectTypeOf<ReturnType<typeof orderMapper.toRow>>().toMatchTypeOf<Row>();

    // @ts-expect-error — `mapper` is required in AggregateStateTableConfig.
    // eslint-disable-next-line no-unused-vars
    const _bad: AggregateStateTableConfig<OrderState, typeof typedOrdersTable> =
      {
        table: typedOrdersTable,
      };
    void _bad;
  });

  it("stateStoreFor throws for unconfigured aggregate", () => {
    const db = createTestDbWithCustomTables();
    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: {
        Order: { table: ordersTable, mapper: jsonStateMapper(ordersTable) },
      },
    });

    // TypeScript would catch this at compile time for literal strings,
    // but at runtime it throws for dynamically constructed names
    expect(() => (adapter.stateStoreFor as any)("Payment")).toThrow(
      'No dedicated state table configured for aggregate "Payment"',
    );
  });

  it("per-aggregate state table: participates in UoW transaction", async () => {
    const db = createTestDbWithCustomTables();
    const adapter = createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: {
        Order: { table: ordersTable, mapper: jsonStateMapper(ordersTable) },
      },
    });

    const orderPersistence = adapter.stateStoreFor("Order");
    const uow = adapter.unitOfWorkFactory();

    uow.enlist(async () => {
      await adapter.eventSourcedPersistence.save(
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

    const paymentEvents = await adapter.eventSourcedPersistence.load(
      "Payment",
      "p1",
    );
    expect(paymentEvents).toHaveLength(1);

    const orderState = await orderPersistence.load("Order", "order-1");
    expect(orderState).not.toBeNull();
    expect(orderState!.state).toEqual({ status: "paid" });
  });

  it("jsonStateMapper throws clear error when convention resolution fails", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(
      `CREATE TABLE bad_table (foo TEXT NOT NULL, bar INTEGER NOT NULL);`,
    );

    // jsonStateMapper(badTable) throws at call time — the table has none
    // of the conventional `aggregateId` / `state` / `version` JS keys.
    expect(() => jsonStateMapper(badTable)).toThrow(
      /aggregateId.*state.*version/,
    );
  });
});
