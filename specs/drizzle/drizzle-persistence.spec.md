---
title: "Drizzle Multi-Dialect Persistence"
module: drizzle/persistence
source_file: packages/adapters/drizzle/src/index.ts
status: implemented
exports:
  - createDrizzlePersistence
  - DrizzlePersistenceInfrastructure
  - DrizzleNodddeSchema
  - DrizzleSnapshotStore
  # @noddde/drizzle/sqlite
  - events (sqliteTable)
  - aggregateStates (sqliteTable)
  - sagaStates (sqliteTable)
  - snapshots (sqliteTable)
  - outbox (sqliteTable)
  # @noddde/drizzle/pg
  - events (pgTable)
  - aggregateStates (pgTable)
  - sagaStates (pgTable)
  - snapshots (pgTable)
  - outbox (pgTable)
  # @noddde/drizzle/mysql
  - events (mysqlTable)
  - aggregateStates (mysqlTable)
  - sagaStates (mysqlTable)
  - snapshots (mysqlTable)
  - outbox (mysqlTable)
depends_on:
  - core/persistence/persistence
  - core/persistence/unit-of-work
  - core/persistence/snapshot
  - core/persistence/outbox
docs:
  - docs/content/docs/infrastructure/orm-adapters.mdx
  - docs/content/docs/domain-configuration/unit-of-work.mdx
---

# Drizzle Multi-Dialect Persistence

> Drizzle ORM adapter for noddde providing persistence and UnitOfWork implementations that work with any Drizzle-supported database dialect (SQLite, PostgreSQL, MySQL). The developer provides their Drizzle database instance and schema tables; the adapter handles transactions internally.

## Type Contract

### Shared types (root `@noddde/drizzle`)

```ts
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  UnitOfWorkFactory,
  SnapshotStore,
  Snapshot,
  PartialEventLoad,
  Event,
  OutboxStore,
  OutboxEntry,
} from "@noddde/core";

/**
 * Schema tables the developer passes to the factory.
 * Each field is a Drizzle table definition (any dialect).
 */
export interface DrizzleNodddeSchema {
  events: any;
  aggregateStates: any;
  sagaStates: any;
  snapshots?: any; // Optional — only needed if using snapshot store
  outbox?: any;    // Optional — only needed if using outbox store
}

/**
 * Result of createDrizzlePersistence.
 */
export interface DrizzlePersistenceInfrastructure {
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  stateStoredPersistence: StateStoredAggregatePersistence;
  sagaPersistence: SagaPersistence;
  unitOfWorkFactory: UnitOfWorkFactory;
  snapshotStore?: SnapshotStore; // Present only when schema.snapshots is provided
  outboxStore?: OutboxStore;  // Present only when schema.outbox is provided
}

/**
 * Drizzle-backed snapshot store for event-sourced aggregates.
 */
export class DrizzleSnapshotStore implements SnapshotStore {
  constructor(
    db: any,
    txStore: DrizzleTransactionStore,
    schema: DrizzleNodddeSchema,
  );
  load(aggregateName: string, aggregateId: string): Promise<Snapshot | null>;
  save(
    aggregateName: string,
    aggregateId: string,
    snapshot: Snapshot,
  ): Promise<void>;
}

/**
 * Drizzle-backed outbox store for transactional outbox pattern.
 */
export class DrizzleOutboxStore implements OutboxStore {
  constructor(
    db: any,
    txStore: DrizzleTransactionStore,
    schema: DrizzleNodddeSchema,
  );
  save(entries: OutboxEntry[]): Promise<void>;
  loadUnpublished(batchSize?: number): Promise<OutboxEntry[]>;
  markPublished(ids: string[]): Promise<void>;
  markPublishedByEventIds(eventIds: string[]): Promise<void>;
  deletePublished(olderThan?: Date): Promise<void>;
}

/**
 * DrizzleEventSourcedAggregatePersistence also implements PartialEventLoad.
 */
export class DrizzleEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence, PartialEventLoad
{
  // ... existing methods ...
  loadAfterVersion(
    aggregateName: string,
    aggregateId: string,
    afterVersion: number,
  ): Promise<Event[]>;
}

/**
 * Single factory for all Drizzle dialects.
 *
 * @param db - A Drizzle database instance (any dialect).
 * @param schema - Table definitions matching the expected column structure.
 */
export function createDrizzlePersistence(
  db: any,
  schema: DrizzleNodddeSchema,
): DrizzlePersistenceInfrastructure;
```

### Dialect schema exports

Each sub-path exports three Drizzle table definitions using the dialect's native types:

**`@noddde/drizzle/sqlite`**

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const events: SQLiteTableWithColumns<...>;
export const aggregateStates: SQLiteTableWithColumns<...>;
export const sagaStates: SQLiteTableWithColumns<...>;
export const snapshots: SQLiteTableWithColumns<...>;
export const outbox: SQLiteTableWithColumns<...>;
```

**`@noddde/drizzle/pg`**

```ts
import { pgTable, text, serial, integer, jsonb } from "drizzle-orm/pg-core";

export const events: PgTableWithColumns<...>;       // serial PK, jsonb payload
export const aggregateStates: PgTableWithColumns<...>;
export const sagaStates: PgTableWithColumns<...>;
export const snapshots: PgTableWithColumns<...>;     // jsonb state
export const outbox: PgTableWithColumns<...>;
```

**`@noddde/drizzle/mysql`**

```ts
import { mysqlTable, varchar, int, text, json } from "drizzle-orm/mysql-core";

export const events: MySqlTableWithColumns<...>;     // auto-increment int PK, json payload, varchar(255) for names
export const aggregateStates: MySqlTableWithColumns<...>;
export const sagaStates: MySqlTableWithColumns<...>;
export const snapshots: MySqlTableWithColumns<...>;
export const outbox: MySqlTableWithColumns<...>;
```

All three dialects define the same logical schema with the same table names (`noddde_events`, `noddde_aggregate_states`, `noddde_saga_states`) and column names.

## Behavioral Requirements

### Factory

1. `createDrizzlePersistence(db, schema)` returns a `DrizzlePersistenceInfrastructure` containing all four components.
2. All four components share a single transaction store so that persistence operations inside a UoW participate in the same transaction context.
3. The factory does not validate the schema structure at runtime — wrong tables will produce runtime errors on first use.

### Persistence (dialect-agnostic)

4. Persistence classes accept schema tables as constructor parameters instead of importing them directly.
5. `EventSourcedAggregatePersistence.save()` appends events with incrementing sequence numbers per `(aggregateName, aggregateId)`.
6. `EventSourcedAggregatePersistence.load()` returns events ordered by sequence number ascending, with JSON-parsed payloads.
7. `EventSourcedAggregatePersistence.load()` returns `[]` for a nonexistent aggregate.
8. `EventSourcedAggregatePersistence.save()` with an empty events array is a no-op.
9. `StateStoredAggregatePersistence.save()` upserts the state (insert if new, update if exists).
10. `StateStoredAggregatePersistence.load()` returns the JSON-parsed state, or `undefined` for a nonexistent aggregate.
11. `SagaPersistence.save()` upserts the saga state.
12. `SagaPersistence.load()` returns the JSON-parsed state, or `undefined` for a nonexistent saga.
13. All persistence operations route through `txStore.current` when inside a transaction, falling back to the base `db` otherwise.

### Unit of Work (dialect-aware)

14. The UoW detects the dialect at construction time: if `db.run` is a function → SQLite mode (explicit `BEGIN`/`COMMIT`/`ROLLBACK` via `db.run(sql\`...\`)`); otherwise → callback mode (uses `db.transaction(async (tx) => { ... })`).
15. `enlist(operation)` buffers an async operation for deferred execution.
16. `deferPublish(...events)` accumulates events for post-commit publishing.
17. `commit()` executes all enlisted operations within a database transaction and returns deferred events.
18. `rollback()` discards all operations and events without touching the database.
19. After `commit()` or `rollback()`, further calls to `enlist`, `deferPublish`, `commit`, or `rollback` throw `"UnitOfWork already completed"`.
20. On commit failure, the transaction is rolled back and no events are returned.

### Schema exports

21. Each dialect sub-path (`/sqlite`, `/pg`, `/mysql`) exports `events`, `aggregateStates`, `sagaStates`, `snapshots`, and `outbox` as Drizzle table definitions using the dialect's native types and column builders.
22. All three dialects use the same table names: `noddde_events`, `noddde_aggregate_states`, `noddde_saga_states`.
23. All three dialects use the same column names (snake_case).
24. PostgreSQL schema uses `serial` for auto-increment PK and `jsonb` for payload/state columns.
25. MySQL schema uses `int` with `.autoincrement()` for PK, `varchar(255)` for name columns, and `json` for payload/state columns.
26. SQLite schema uses `integer` with `autoIncrement` for PK and `text` for all string/JSON columns.

### Snapshots and Partial Event Load

27. `DrizzleSnapshotStore.save()` upserts the snapshot (insert if new, update if exists) using the `snapshots` schema table.
28. `DrizzleSnapshotStore.load()` returns the JSON-parsed state and version, or `null` if no snapshot exists.
29. `DrizzleEventSourcedAggregatePersistence.loadAfterVersion()` loads events with `sequence_number > afterVersion` ordered by `sequence_number ASC`.
30. `snapshotStore` is only included in the factory return when `schema.snapshots` is provided.
31. Snapshot operations route through `txStore.current` like all other persistence operations.

### Outbox Store

32. `DrizzleOutboxStore.save()` inserts entries with `JSON.stringify(entry.event)` for the event column. Runs inside active transaction via `txStore.current`.
33. `DrizzleOutboxStore.loadUnpublished()` returns entries where `published_at IS NULL` ordered by `created_at ASC`, limited by `batchSize` (default 100). Deserializes event from JSON.
34. `DrizzleOutboxStore.markPublished()` updates `published_at` to current ISO timestamp for matching entry IDs.
35. `DrizzleOutboxStore.markPublishedByEventIds()` loads unpublished entries, filters by deserialized `event.metadata.eventId`, and marks matching entries as published.
36. `DrizzleOutboxStore.deletePublished()` removes rows where `published_at IS NOT NULL` and optionally `created_at < olderThan`.
37. `outboxStore` is only included in the factory return when `schema.outbox` is provided (same pattern as `snapshotStore`).
38. Outbox operations route through `txStore.current` like all other persistence operations.

## Invariants

- [ ] Events saved and loaded maintain FIFO order (sequence number ordering).
- [ ] Different `(aggregateName, aggregateId)` pairs are fully isolated.
- [ ] A committed UoW cannot be reused.
- [ ] Transaction store is `null` outside a UoW boundary.
- [ ] All persistence operations within a UoW execute in the same database transaction.

## Edge Cases

- **First save for a new aggregate**: Creates the record. No prior data exists. `load()` before any save returns `[]` (event-sourced) or `undefined` (state-stored/saga).
- **Multiple saves to same aggregate (event-sourced)**: Events append with incrementing sequence numbers.
- **Multiple saves to same aggregate (state-stored)**: State is overwritten (upsert).
- **Empty event array on save**: No-op, no database call.
- **Commit with no enlisted operations**: Succeeds, returns deferred events (if any).
- **Operation failure mid-commit**: Transaction rolls back, error propagates, no events returned.
- **Double commit/rollback**: Throws `"UnitOfWork already completed"`.
- **Transaction store cleared after commit/rollback**: `txStore.current` is always reset to `null`.
- **Outbox save with empty entries array**: No-op, no database call.
- **markPublishedByEventIds with no matches**: No-op, no error.

## Integration Points

- Persistence implementations satisfy `EventSourcedAggregatePersistence`, `StateStoredAggregatePersistence`, and `SagaPersistence` from `@noddde/core`.
- UoW satisfies `UnitOfWork` from `@noddde/core`.
- Factory return type matches the infrastructure shape expected by `configureDomain()`.
- Schema exports are convenience-only — developers can define their own tables matching the expected column structure.
- Outbox store satisfies `OutboxStore` from `@noddde/core`.

## Storage Schema

All three dialects define the same logical schema:

```
noddde_events
├── id               (auto-increment PK)
├── aggregate_name   (string, NOT NULL)
├── aggregate_id     (string, NOT NULL)
├── sequence_number  (integer, NOT NULL)
├── event_name       (string, NOT NULL)
└── payload          (JSON string, NOT NULL)

noddde_aggregate_states
├── aggregate_name   (string, PK part 1)
├── aggregate_id     (string, PK part 2)
└── state            (JSON string, NOT NULL)

noddde_saga_states
├── saga_name        (string, PK part 1)
├── saga_id          (string, PK part 2)
└── state            (JSON string, NOT NULL)

noddde_snapshots
├── aggregate_name   (string, PK part 1)
├── aggregate_id     (string, PK part 2)
├── state            (JSON string, NOT NULL)
└── version          (integer, NOT NULL)

noddde_outbox
├── id               (string, PK)
├── event            (JSON string, NOT NULL)
├── aggregate_name   (string, nullable)
├── aggregate_id     (string, nullable)
├── created_at       (string, NOT NULL)
└── published_at     (string, nullable)
```

## Test Scenarios

### Factory creates all four infrastructure components

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createDrizzlePersistence } from "@noddde/drizzle";
import { events, aggregateStates, sagaStates, snapshots, outbox } from "@noddde/drizzle/sqlite";

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
});
```

### Event-sourced save and load roundtrip

```ts
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
  expect(loaded[0]).toEqual({ name: "OrderPlaced", payload: { total: 100 } });
  expect(loaded[1]).toEqual({
    name: "OrderConfirmed",
    payload: { confirmedAt: "2024-01-01" },
  });
});
```

### Event-sourced load returns empty array for nonexistent aggregate

```ts
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
```

### Event-sourced appends events across multiple saves

```ts
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
```

### Event-sourced namespace isolation

```ts
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
```

### State-stored save and load roundtrip

```ts
it("saves and loads state with JSON parsing", async () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events,
    aggregateStates,
    sagaStates,
  });
  const persistence = infra.stateStoredPersistence;

  await persistence.save("Account", "acc-1", { balance: 500, owner: "Alice" });
  const state = await persistence.load("Account", "acc-1");
  expect(state).toEqual({ balance: 500, owner: "Alice" });
});
```

### State-stored returns undefined for nonexistent aggregate

```ts
it("returns undefined for nonexistent aggregate", async () => {
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
```

### State-stored overwrites on repeated save

```ts
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
```

### Saga save and load roundtrip

```ts
it("saves and loads saga state", async () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events,
    aggregateStates,
    sagaStates,
  });
  const persistence = infra.sagaPersistence;

  await persistence.save("OrderSaga", "saga-1", { status: "active", step: 2 });
  const state = await persistence.load("OrderSaga", "saga-1");
  expect(state).toEqual({ status: "active", step: 2 });
});
```

### UoW commits all operations in a transaction

```ts
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
    await infra.stateStoredPersistence.save("Account", "a1", { balance: 50 });
  });
  uow.deferPublish({ name: "OrderPlaced", payload: { total: 50 } });

  const publishedEvents = await uow.commit();

  expect(publishedEvents).toHaveLength(1);
  expect(publishedEvents[0]!.name).toBe("OrderPlaced");

  const loadedEvents = await infra.eventSourcedPersistence.load("Order", "o1");
  expect(loadedEvents).toHaveLength(1);

  const loadedState = await infra.stateStoredPersistence.load("Account", "a1");
  expect(loadedState).toEqual({ balance: 50 });
});
```

### UoW rollback discards everything

```ts
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
```

### UoW throws after completion

```ts
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
  await expect(uow.rollback()).rejects.toThrow("UnitOfWork already completed");
});
```

### Snapshot store: save and load roundtrip

```ts
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
```

### Snapshot store: returns null for unknown aggregate

```ts
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
```

### Snapshot store: overwrites on repeated saves

```ts
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
```

### snapshotStore is not present when schema.snapshots is not provided

```ts
it("snapshotStore is not present when schema.snapshots is not provided", () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events,
    aggregateStates,
    sagaStates,
  });

  expect(infra.snapshotStore).toBeUndefined();
});
```

### loadAfterVersion: returns events after given version

```ts
it("loadAfterVersion: returns events after given version", async () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events,
    aggregateStates,
    sagaStates,
    snapshots,
  });
  const persistence = infra.eventSourcedPersistence;

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
});
```

### loadAfterVersion: returns empty array when afterVersion >= stream length

```ts
it("loadAfterVersion: returns empty array when afterVersion >= stream length", async () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events,
    aggregateStates,
    sagaStates,
    snapshots,
  });
  const persistence = infra.eventSourcedPersistence;

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
```

### Outbox store: save and load unpublished entries

```ts
it("outbox store: save and load unpublished entries", async () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events, aggregateStates, sagaStates, outbox,
  });
  expect(infra.outboxStore).toBeDefined();
  const store = infra.outboxStore!;

  await store.save([{
    id: "entry-1",
    event: { name: "OrderPlaced", payload: { total: 100 }, metadata: { eventId: "evt-1" } },
    aggregateName: "Order",
    aggregateId: "order-1",
    createdAt: "2024-01-01T00:00:00.000Z",
    publishedAt: null,
  }]);

  const unpublished = await store.loadUnpublished();
  expect(unpublished).toHaveLength(1);
  expect(unpublished[0]!.event.name).toBe("OrderPlaced");
  expect(unpublished[0]!.publishedAt).toBeNull();
});
```

### Outbox store: markPublished sets publishedAt

```ts
it("outbox store: markPublished sets publishedAt", async () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events, aggregateStates, sagaStates, outbox,
  });
  const store = infra.outboxStore!;

  await store.save([{
    id: "entry-1",
    event: { name: "OrderPlaced", payload: {} },
    createdAt: "2024-01-01T00:00:00.000Z",
    publishedAt: null,
  }]);

  await store.markPublished(["entry-1"]);
  const unpublished = await store.loadUnpublished();
  expect(unpublished).toHaveLength(0);
});
```

### Outbox store: markPublishedByEventIds matches on event metadata

```ts
it("outbox store: markPublishedByEventIds matches on event metadata", async () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events, aggregateStates, sagaStates, outbox,
  });
  const store = infra.outboxStore!;

  await store.save([
    {
      id: "entry-1",
      event: { name: "OrderPlaced", payload: {}, metadata: { eventId: "evt-1" } },
      createdAt: "2024-01-01T00:00:00.000Z",
      publishedAt: null,
    },
    {
      id: "entry-2",
      event: { name: "OrderConfirmed", payload: {}, metadata: { eventId: "evt-2" } },
      createdAt: "2024-01-01T00:00:01.000Z",
      publishedAt: null,
    },
  ]);

  await store.markPublishedByEventIds(["evt-1"]);
  const unpublished = await store.loadUnpublished();
  expect(unpublished).toHaveLength(1);
  expect(unpublished[0]!.id).toBe("entry-2");
});
```

### Outbox store: deletePublished removes only published entries

```ts
it("outbox store: deletePublished removes only published entries", async () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events, aggregateStates, sagaStates, outbox,
  });
  const store = infra.outboxStore!;

  await store.save([
    {
      id: "entry-1",
      event: { name: "OrderPlaced", payload: {} },
      createdAt: "2024-01-01T00:00:00.000Z",
      publishedAt: null,
    },
  ]);
  await store.markPublished(["entry-1"]);

  await store.deletePublished();
  const unpublished = await store.loadUnpublished();
  expect(unpublished).toHaveLength(0);
});
```

### Outbox store: not present when schema.outbox not provided

```ts
it("outbox store: not present when schema.outbox not provided", () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events, aggregateStates, sagaStates,
  });
  expect(infra.outboxStore).toBeUndefined();
});
```
