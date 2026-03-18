---
title: "Drizzle Multi-Dialect Persistence"
module: drizzle/persistence
source_file: packages/drizzle/src/index.ts
status: implemented
exports:
  - createDrizzlePersistence
  - DrizzlePersistenceInfrastructure
  - DrizzleNodddeSchema
  # @noddde/drizzle/sqlite
  - events (sqliteTable)
  - aggregateStates (sqliteTable)
  - sagaStates (sqliteTable)
  # @noddde/drizzle/pg
  - events (pgTable)
  - aggregateStates (pgTable)
  - sagaStates (pgTable)
  # @noddde/drizzle/mysql
  - events (mysqlTable)
  - aggregateStates (mysqlTable)
  - sagaStates (mysqlTable)
depends_on:
  - core/persistence/persistence
  - core/persistence/unit-of-work
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
} from "@noddde/core";

/**
 * Schema tables the developer passes to the factory.
 * Each field is a Drizzle table definition (any dialect).
 */
export interface DrizzleNodddeSchema {
  events: any;
  aggregateStates: any;
  sagaStates: any;
}

/**
 * Result of createDrizzlePersistence.
 */
export interface DrizzlePersistenceInfrastructure {
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  stateStoredPersistence: StateStoredAggregatePersistence;
  sagaPersistence: SagaPersistence;
  unitOfWorkFactory: UnitOfWorkFactory;
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
```

**`@noddde/drizzle/pg`**

```ts
import { pgTable, text, serial, integer, jsonb } from "drizzle-orm/pg-core";

export const events: PgTableWithColumns<...>;       // serial PK, jsonb payload
export const aggregateStates: PgTableWithColumns<...>;
export const sagaStates: PgTableWithColumns<...>;
```

**`@noddde/drizzle/mysql`**

```ts
import { mysqlTable, varchar, int, text, json } from "drizzle-orm/mysql-core";

export const events: MySqlTableWithColumns<...>;     // auto-increment int PK, json payload, varchar(255) for names
export const aggregateStates: MySqlTableWithColumns<...>;
export const sagaStates: MySqlTableWithColumns<...>;
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

21. Each dialect sub-path (`/sqlite`, `/pg`, `/mysql`) exports `events`, `aggregateStates`, `sagaStates` as Drizzle table definitions using the dialect's native types and column builders.
22. All three dialects use the same table names: `noddde_events`, `noddde_aggregate_states`, `noddde_saga_states`.
23. All three dialects use the same column names (snake_case).
24. PostgreSQL schema uses `serial` for auto-increment PK and `jsonb` for payload/state columns.
25. MySQL schema uses `int` with `.autoincrement()` for PK, `varchar(255)` for name columns, and `json` for payload/state columns.
26. SQLite schema uses `integer` with `autoIncrement` for PK and `text` for all string/JSON columns.

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

## Integration Points

- Persistence implementations satisfy `EventSourcedAggregatePersistence`, `StateStoredAggregatePersistence`, and `SagaPersistence` from `@noddde/core`.
- UoW satisfies `UnitOfWork` from `@noddde/core`.
- Factory return type matches the infrastructure shape expected by `configureDomain()`.
- Schema exports are convenience-only — developers can define their own tables matching the expected column structure.

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
```

## Test Scenarios

### Factory creates all four infrastructure components

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createDrizzlePersistence } from "@noddde/drizzle";
import { events, aggregateStates, sagaStates } from "@noddde/drizzle/sqlite";

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
