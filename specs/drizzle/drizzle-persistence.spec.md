---
title: "Drizzle Multi-Dialect Persistence"
module: drizzle/persistence
source_file: packages/adapters/drizzle/src/index.ts
status: implemented
exports:
  - createDrizzleAdapter
  - DrizzleAdapterConfig
  - DrizzleAdapterResult
  - AggregateStateTableConfig
  - StateTableColumnMap
  - createDrizzlePersistence (deprecated)
  - DrizzlePersistenceInfrastructure (deprecated)
  - DrizzleNodddeSchema (deprecated)
  - DrizzleSnapshotStore
  - generateDrizzleMigration
  - DrizzleMigrationOptions
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

### Primary API (root `@noddde/drizzle`)

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
 * Column mapping for a custom state-stored aggregate table.
 * Maps logical noddde columns to actual Drizzle column references.
 * If omitted from AggregateStateTableConfig, columns are resolved
 * by convention (looks for columns named aggregate_id, state, version).
 */
export interface StateTableColumnMap {
  /** Column holding the aggregate instance ID (string PK). */
  aggregateId: any;
  /** Column holding the serialized aggregate state (text/jsonb). */
  state: any;
  /** Column holding the version number (integer). */
  version: any;
}

/**
 * Configuration for a per-aggregate state table.
 */
export interface AggregateStateTableConfig {
  /** The Drizzle table definition. */
  table: any;
  /** Column mappings. If omitted, uses convention-based defaults. */
  columns?: Partial<StateTableColumnMap>;
}

/**
 * Configuration for createDrizzleAdapter.
 * eventStore and sagaStore are required. All other fields are optional
 * and their presence determines the shape of the result type.
 */
export interface DrizzleAdapterConfig {
  /** Drizzle table definition for the event store. Required. */
  eventStore: any;
  /** Drizzle table definition for the saga state store. Required. */
  sagaStore: any;
  /** Drizzle table definition for the shared aggregate state store. Optional. */
  stateStore?: any;
  /** Drizzle table definition for the snapshot store. Optional. */
  snapshotStore?: any;
  /** Drizzle table definition for the outbox store. Optional. */
  outboxStore?: any;
  /** Per-aggregate dedicated state tables with custom column mappings. Optional. */
  aggregateStates?: Record<string, AggregateStateTableConfig>;
}

/**
 * Result of createDrizzleAdapter. The type narrows based on which
 * optional stores were configured — configured stores appear as
 * non-optional, absent stores are not present on the type at all.
 */
export type DrizzleAdapterResult<C extends DrizzleAdapterConfig> = {
  /** Shared event-sourced persistence (shared noddde_events table). Always present. */
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  /** Saga persistence (shared saga states table). Always present. */
  sagaPersistence: SagaPersistence;
  /** Factory for creating Drizzle-backed UnitOfWork instances. Always present. */
  unitOfWorkFactory: UnitOfWorkFactory;
} & (C extends { stateStore: any }
  ? { stateStoredPersistence: StateStoredAggregatePersistence }
  : {}) &
  (C extends { snapshotStore: any } ? { snapshotStore: SnapshotStore } : {}) &
  (C extends { outboxStore: any } ? { outboxStore: OutboxStore } : {}) &
  (C extends { aggregateStates: Record<string, any> }
    ? {
        /**
         * Returns a StateStoredAggregatePersistence bound to a dedicated table.
         * Only accepts keys from the aggregateStates config.
         */
        stateStoreFor(
          name: keyof C["aggregateStates"] & string,
        ): StateStoredAggregatePersistence;
      }
    : {});

/**
 * Creates a fully-configured Drizzle persistence adapter.
 * All persistence instances share the same DrizzleTransactionStore,
 * ensuring UoW atomicity across shared and dedicated tables.
 *
 * The return type narrows based on the config: only configured optional
 * stores appear in the result, eliminating the need for `!` non-null assertions.
 *
 * Throws at creation time (not lazily) if convention-based column resolution
 * fails for any per-aggregate state table.
 *
 * @param db - A Drizzle database instance (any dialect).
 * @param config - Adapter configuration with table definitions.
 * @returns Typed persistence infrastructure.
 */
export function createDrizzleAdapter<const C extends DrizzleAdapterConfig>(
  db: any,
  config: C,
): DrizzleAdapterResult<C>;

/**
 * Drizzle-backed snapshot store for event-sourced aggregates.
 */
export class DrizzleSnapshotStore implements SnapshotStore {
  constructor(db: any, txStore: DrizzleTransactionStore, schema: any);
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
  constructor(db: any, txStore: DrizzleTransactionStore, schema: any);
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
```

### Deprecated API

```ts
/**
 * @deprecated Use createDrizzleAdapter instead. Preserved for backwards
 * compatibility; delegates to createDrizzleAdapter internally.
 */
export interface DrizzleNodddeSchema {
  events: any;
  aggregateStates: any;
  sagaStates: any;
  snapshots?: any;
  outbox?: any;
}

export interface DrizzlePersistenceInfrastructure {
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  stateStoredPersistence: StateStoredAggregatePersistence;
  sagaPersistence: SagaPersistence;
  unitOfWorkFactory: UnitOfWorkFactory;
  snapshotStore?: SnapshotStore;
  outboxStore?: OutboxStore;
}

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

### Migration Generation

```ts
/**
 * Options for generating Drizzle-Kit compatible migration SQL.
 */
export interface DrizzleMigrationOptions {
  /** Which shared noddde tables to include. */
  sharedTables?: {
    events?: boolean; // default true
    aggregateStates?: boolean; // default true
    sagaStates?: boolean; // default true
    snapshots?: boolean; // default false
    outbox?: boolean; // default false
  };
  /** Per-aggregate state tables to include in the migration. */
  aggregateStateTables?: Record<
    string,
    {
      /** Table name in the database. */
      tableName: string;
      /** Custom column names. Defaults: aggregate_id, state, version. */
      columns?: {
        aggregateId?: string;
        state?: string;
        version?: string;
      };
    }
  >;
}

/**
 * Generates a Drizzle-Kit compatible migration SQL string.
 * Can be written to a migration directory for drizzle-kit push/migrate.
 *
 * @param dialect - Target SQL dialect.
 * @param options - Migration configuration.
 * @returns SQL string with CREATE TABLE and CREATE INDEX statements.
 */
export function generateDrizzleMigration(
  dialect: "postgresql" | "mysql" | "sqlite",
  options?: DrizzleMigrationOptions,
): string;
```

## Behavioral Requirements

### Factory

1. `createDrizzleAdapter(db, config)` returns a `DrizzleAdapterResult<C>` with at minimum `eventSourcedPersistence`, `sagaPersistence`, and `unitOfWorkFactory`.
2. All persistence instances share a single `DrizzleTransactionStore` so that operations inside a UoW participate in the same transaction context.
3. `eventStore` and `sagaStore` are required fields in `DrizzleAdapterConfig` — omitting them is a TypeScript compile error.
4. The return type narrows based on the config: `stateStoredPersistence` is present only if `stateStore` is provided, `snapshotStore` only if `snapshotStore` is provided, `outboxStore` only if `outboxStore` is provided, `stateStoreFor()` only if `aggregateStates` is provided.

### Persistence (dialect-agnostic)

5. Persistence classes accept schema tables as constructor parameters instead of importing them directly.
6. `EventSourcedAggregatePersistence.save()` appends events with incrementing sequence numbers per `(aggregateName, aggregateId)`.
7. `EventSourcedAggregatePersistence.load()` returns events ordered by sequence number ascending, with JSON-parsed payloads.
8. `EventSourcedAggregatePersistence.load()` returns `[]` for a nonexistent aggregate.
9. `EventSourcedAggregatePersistence.save()` with an empty events array is a no-op.
10. `StateStoredAggregatePersistence.save()` upserts the state (insert if new, update if exists).
11. `StateStoredAggregatePersistence.load()` returns the JSON-parsed state, or `undefined` for a nonexistent aggregate.
12. `SagaPersistence.save()` upserts the saga state.
13. `SagaPersistence.load()` returns the JSON-parsed state, or `undefined` for a nonexistent saga.
14. All persistence operations route through `txStore.current` when inside a transaction, falling back to the base `db` otherwise.

### Unit of Work (dialect-aware)

15. The UoW detects the dialect at construction time: if `db.run` is a function → SQLite mode (explicit `BEGIN`/`COMMIT`/`ROLLBACK` via `db.run(sql\`...\`)`); otherwise → callback mode (uses `db.transaction(async (tx) => { ... })`).
16. `enlist(operation)` buffers an async operation for deferred execution.
17. `deferPublish(...events)` accumulates events for post-commit publishing.
18. `commit()` executes all enlisted operations within a database transaction and returns deferred events.
19. `rollback()` discards all operations and events without touching the database.
20. After `commit()` or `rollback()`, further calls to `enlist`, `deferPublish`, `commit`, or `rollback` throw `"UnitOfWork already completed"`.
21. On commit failure, the transaction is rolled back and no events are returned.

### Schema exports

22. Each dialect sub-path (`/sqlite`, `/pg`, `/mysql`) exports `events`, `aggregateStates`, `sagaStates`, `snapshots`, and `outbox` as Drizzle table definitions using the dialect's native types and column builders.
23. All three dialects use the same table names: `noddde_events`, `noddde_aggregate_states`, `noddde_saga_states`.
24. All three dialects use the same column names (snake_case).
25. PostgreSQL schema uses `serial` for auto-increment PK and `jsonb` for payload/state columns.
26. MySQL schema uses `int` with `.autoincrement()` for PK, `varchar(255)` for name columns, and `json` for payload/state columns.
27. SQLite schema uses `integer` with `autoIncrement` for PK and `text` for all string/JSON columns.

### Snapshots and Partial Event Load

28. `DrizzleSnapshotStore.save()` upserts the snapshot (insert if new, update if exists) using the `snapshots` schema table.
29. `DrizzleSnapshotStore.load()` returns the JSON-parsed state and version, or `null` if no snapshot exists.
30. `DrizzleEventSourcedAggregatePersistence.loadAfterVersion()` loads events with `sequence_number > afterVersion` ordered by `sequence_number ASC`.
31. `snapshotStore` is only included in the result when `config.snapshotStore` is provided.
32. Snapshot operations route through `txStore.current` like all other persistence operations.

### Outbox Store

33. `DrizzleOutboxStore.save()` inserts entries with `JSON.stringify(entry.event)` for the event column. Runs inside active transaction via `txStore.current`.
34. `DrizzleOutboxStore.loadUnpublished()` returns entries where `published_at IS NULL` ordered by `created_at ASC`, limited by `batchSize` (default 100). Deserializes event from JSON.
35. `DrizzleOutboxStore.markPublished()` updates `published_at` to current ISO timestamp for matching entry IDs.
36. `DrizzleOutboxStore.markPublishedByEventIds()` loads unpublished entries, filters by deserialized `event.metadata.eventId`, and marks matching entries as published.
37. `DrizzleOutboxStore.deletePublished()` removes rows where `published_at IS NOT NULL` and optionally `created_at < olderThan`.
38. `outboxStore` is only included in the result when `config.outboxStore` is provided (same pattern as `snapshotStore`).
39. Outbox operations route through `txStore.current` like all other persistence operations.

### Config-Based Adapter

40. `createDrizzleAdapter(db, config)` accepts a `DrizzleAdapterConfig` where `eventStore` and `sagaStore` are required (enforced at the TypeScript level).
41. `config.stateStore` configures the shared aggregate states table. Optional — only needed if some aggregates use the shared table.
42. `config.snapshotStore` and `config.outboxStore` are optional.
43. `config.aggregateStates` is a `Record<string, AggregateStateTableConfig>` mapping aggregate names to dedicated state table configurations.
44. `createDrizzleAdapter` returns a `DrizzleAdapterResult<C>` with all configured stores.
45. All persistence instances from a single `createDrizzleAdapter` call share the same `DrizzleTransactionStore` so that operations inside a UoW participate in the same transaction.

### Per-Aggregate State Persistence

46. `stateStoreFor(aggregateName)` returns a `StateStoredAggregatePersistence` bound to that aggregate's dedicated table.
47. `stateStoreFor(aggregateName)` is type-safe: only accepts keys from the `aggregateStates` config as valid aggregate names.
48. `stateStoreFor(aggregateName)` throws at runtime if no dedicated table was configured for that aggregate name.
49. The dedicated state persistence ignores the `aggregateName` parameter passed to `save()`/`load()` — the table itself is the namespace.
50. The dedicated state persistence uses the column mapping to read/write the correct columns in the dedicated table.
51. When `columns` is omitted from `AggregateStateTableConfig`, columns are resolved by convention: looks for columns named `aggregate_id`, `state`, `version` in the Drizzle table definition.
52. If convention-based column resolution fails (required columns not found), `createDrizzleAdapter` throws at call time with a clear error listing the available columns in the table.
53. Dedicated state persistence participates in the same UoW transaction as shared persistence via the shared `DrizzleTransactionStore`.

### Migration Generation

54. `generateDrizzleMigration(dialect)` returns a SQL string with `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` statements.
55. Default (no options) includes shared tables: `noddde_events`, `noddde_aggregate_states`, `noddde_saga_states`.
56. When `options.sharedTables.snapshots` or `.outbox` is `true`, the corresponding table is included.
57. When `options.aggregateStateTables` is provided, generates `CREATE TABLE IF NOT EXISTS` for each custom table with `aggregate_id TEXT NOT NULL PRIMARY KEY`, `state` (dialect-appropriate JSON type), `version INTEGER NOT NULL DEFAULT 0` columns (or custom column names from config).
58. Output is dialect-aware: PostgreSQL uses `SERIAL`/`JSONB`/`TEXT`, MySQL uses `INT AUTO_INCREMENT`/`JSON`/`VARCHAR(255)`, SQLite uses `INTEGER`/`TEXT`.
59. All DDL statements use `IF NOT EXISTS` for idempotent migrations.

### Backwards Compatibility

60. `createDrizzlePersistence(db, schema)` continues to work with the same signature and return type (`DrizzlePersistenceInfrastructure`).
61. `createDrizzlePersistence` delegates to `createDrizzleAdapter` internally.
62. The `DrizzlePersistenceInfrastructure` return type is unchanged.

## Invariants

- [ ] Events saved and loaded maintain FIFO order (sequence number ordering).
- [ ] Different `(aggregateName, aggregateId)` pairs are fully isolated.
- [ ] A committed UoW cannot be reused.
- [ ] Transaction store is `null` outside a UoW boundary.
- [ ] All persistence operations within a UoW execute in the same database transaction.
- [ ] Dedicated state persistence instances share the same txStore as shared persistence.
- [ ] `eventStore` and `sagaStore` are required in config (enforced at compile time).
- [ ] `stateStoreFor()` fails fast if aggregate name was not registered.
- [ ] Convention-based column resolution fails fast at `createDrizzleAdapter` call time, not at query time.

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
- **Missing eventStore in config**: TypeScript compile error since `eventStore` is a required field in `DrizzleAdapterConfig`.
- **Missing sagaStore in config**: TypeScript compile error since `sagaStore` is a required field in `DrizzleAdapterConfig`.
- **stateStoreFor unknown aggregate**: Throws `"No dedicated state table configured for aggregate \"Foo\". Add \"Foo\" to the aggregateStates config."`.
- **stateStoreFor with invalid key**: TypeScript compile error — only keys from `config.aggregateStates` are accepted.
- **Convention resolution with missing columns**: `createDrizzleAdapter` throws at call time listing available columns and which required columns are missing.
- **Dedicated and shared persistence in same UoW**: Both participate in the same transaction via shared txStore.
- **Multiple dedicated tables in same UoW**: All share the same transaction.
- **Migration generation with empty options**: Returns SQL for all three shared tables.

## Integration Points

- Persistence implementations satisfy `EventSourcedAggregatePersistence`, `StateStoredAggregatePersistence`, and `SagaPersistence` from `@noddde/core`.
- UoW satisfies `UnitOfWork` from `@noddde/core`.
- Factory return type matches the infrastructure shape expected by `DomainWiring`.
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

### Factory creates all infrastructure components

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  createDrizzleAdapter,
  createDrizzlePersistence,
} from "@noddde/drizzle";
import {
  events,
  aggregateStates,
  sagaStates,
  snapshots,
  outbox,
} from "@noddde/drizzle/sqlite";

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
});
```

### Event-sourced save and load roundtrip

```ts
it("saves and loads events with JSON-parsed payloads", async () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });
  const persistence = adapter.eventSourcedPersistence;

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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });

  const loaded = await adapter.eventSourcedPersistence.load(
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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });
  const persistence = adapter.eventSourcedPersistence;

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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });
  const persistence = adapter.eventSourcedPersistence;

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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    stateStore: aggregateStates,
  });
  const persistence = adapter.stateStoredPersistence;

  await persistence.save("Account", "acc-1", { balance: 500, owner: "Alice" });
  const state = await persistence.load("Account", "acc-1");
  expect(state).toEqual({ balance: 500, owner: "Alice" });
});
```

### State-stored returns undefined for nonexistent aggregate

```ts
it("returns undefined for nonexistent aggregate", async () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    stateStore: aggregateStates,
  });

  const state = await adapter.stateStoredPersistence.load(
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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    stateStore: aggregateStates,
  });
  const persistence = adapter.stateStoredPersistence;

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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });
  const persistence = adapter.sagaPersistence;

  await persistence.save("OrderSaga", "saga-1", { status: "active", step: 2 });
  const state = await persistence.load("OrderSaga", "saga-1");
  expect(state).toEqual({ status: "active", step: 2 });
});
```

### UoW commits all operations in a transaction

```ts
it("commits all operations atomically and returns deferred events", async () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    stateStore: aggregateStates,
  });
  const uow = adapter.unitOfWorkFactory();

  uow.enlist(async () => {
    await adapter.eventSourcedPersistence.save("Order", "o1", [
      { name: "OrderPlaced", payload: { total: 50 } },
    ]);
  });
  uow.enlist(async () => {
    await adapter.stateStoredPersistence.save("Account", "a1", { balance: 50 });
  });
  uow.deferPublish({ name: "OrderPlaced", payload: { total: 50 } });

  const publishedEvents = await uow.commit();

  expect(publishedEvents).toHaveLength(1);
  expect(publishedEvents[0]!.name).toBe("OrderPlaced");

  const loadedEvents = await adapter.eventSourcedPersistence.load(
    "Order",
    "o1",
  );
  expect(loadedEvents).toHaveLength(1);

  const loadedState = await adapter.stateStoredPersistence.load(
    "Account",
    "a1",
  );
  expect(loadedState).toEqual({ balance: 50 });
});
```

### UoW rollback discards everything

```ts
it("rollback discards all operations and events", async () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });
  const uow = adapter.unitOfWorkFactory();

  uow.enlist(async () => {
    await adapter.eventSourcedPersistence.save("Order", "o1", [
      { name: "OrderPlaced", payload: {} },
    ]);
  });
  uow.deferPublish({ name: "OrderPlaced", payload: {} });

  await uow.rollback();

  const loaded = await adapter.eventSourcedPersistence.load("Order", "o1");
  expect(loaded).toEqual([]);
});
```

### UoW throws after completion

```ts
it("throws on any operation after commit or rollback", async () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });
  const uow = adapter.unitOfWorkFactory();

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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    snapshotStore: snapshots,
  });

  // snapshotStore is non-optional on the result type since config includes snapshotStore
  const store = adapter.snapshotStore;

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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    snapshotStore: snapshots,
  });

  const loaded = await adapter.snapshotStore.load("Order", "nonexistent");
  expect(loaded).toBeNull();
});
```

### Snapshot store: overwrites on repeated saves

```ts
it("snapshot store: overwrites on repeated saves", async () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    snapshotStore: snapshots,
  });
  const store = adapter.snapshotStore;

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

### snapshotStore is not present when config.snapshotStore is not provided

```ts
it("snapshotStore is not present when config.snapshotStore is not provided", () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });

  // TypeScript: adapter.snapshotStore does not exist on the type
  // At runtime, the property is simply absent
  expect((adapter as any).snapshotStore).toBeUndefined();
});
```

### loadAfterVersion: returns events after given version

```ts
it("loadAfterVersion: returns events after given version", async () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });
  const persistence = adapter.eventSourcedPersistence;

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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });
  const persistence = adapter.eventSourcedPersistence;

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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    outboxStore: outbox,
  });
  // outboxStore is non-optional on the result type since config includes outboxStore
  const store = adapter.outboxStore;

  await store.save([
    {
      id: "entry-1",
      event: {
        name: "OrderPlaced",
        payload: { total: 100 },
        metadata: { eventId: "evt-1" },
      },
      aggregateName: "Order",
      aggregateId: "order-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      publishedAt: null,
    },
  ]);

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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    outboxStore: outbox,
  });
  const store = adapter.outboxStore;

  await store.save([
    {
      id: "entry-1",
      event: { name: "OrderPlaced", payload: {} },
      createdAt: "2024-01-01T00:00:00.000Z",
      publishedAt: null,
    },
  ]);

  await store.markPublished(["entry-1"]);
  const unpublished = await store.loadUnpublished();
  expect(unpublished).toHaveLength(0);
});
```

### Outbox store: markPublishedByEventIds matches on event metadata

```ts
it("outbox store: markPublishedByEventIds matches on event metadata", async () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    outboxStore: outbox,
  });
  const store = adapter.outboxStore;

  await store.save([
    {
      id: "entry-1",
      event: {
        name: "OrderPlaced",
        payload: {},
        metadata: { eventId: "evt-1" },
      },
      createdAt: "2024-01-01T00:00:00.000Z",
      publishedAt: null,
    },
    {
      id: "entry-2",
      event: {
        name: "OrderConfirmed",
        payload: {},
        metadata: { eventId: "evt-2" },
      },
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
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    outboxStore: outbox,
  });
  const store = adapter.outboxStore;

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

### Outbox store: not present when config.outboxStore not provided

```ts
it("outbox store: not present when config.outboxStore not provided", () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });
  // TypeScript: adapter.outboxStore does not exist on the type
  expect((adapter as any).outboxStore).toBeUndefined();
});
```

### Adapter: creates all stores with shared txStore

```ts
it("creates all stores with shared transaction context", () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    stateStore: aggregateStates,
    snapshotStore: snapshots,
    outboxStore: outbox,
    aggregateStates: {
      Order: { table: aggregateStates },
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
```

### Adapter: stateStoredPersistence absent when stateStore not in config

```ts
it("stateStoredPersistence is absent when stateStore not in config", () => {
  const db = createTestDb();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
  });

  // TypeScript: adapter.stateStoredPersistence does not exist on the type
  expect((adapter as any).stateStoredPersistence).toBeUndefined();
});
```

### Backwards compat: createDrizzlePersistence delegates to createDrizzleAdapter

```ts
it("createDrizzlePersistence continues to work unchanged", async () => {
  const db = createTestDb();
  const infra = createDrizzlePersistence(db, {
    events,
    aggregateStates,
    sagaStates,
  });

  // Same behavior as before
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
```

### Per-aggregate state table: save and load roundtrip

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

const ordersTable = sqliteTable("orders", {
  aggregateId: text("aggregate_id").notNull().primaryKey(),
  state: text("state").notNull(),
  version: integer("version").notNull().default(0),
});

function createTestDbWithCustomTables() {
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

it("per-aggregate state table: save and load roundtrip", async () => {
  const db = createTestDbWithCustomTables();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    aggregateStates: {
      Order: { table: ordersTable },
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
```

### Per-aggregate state table: returns null for nonexistent aggregate

```ts
it("per-aggregate state table: returns null for nonexistent", async () => {
  const db = createTestDbWithCustomTables();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    aggregateStates: {
      Order: { table: ordersTable },
    },
  });

  const loaded = await adapter
    .stateStoreFor("Order")
    .load("Order", "nonexistent");
  expect(loaded).toBeNull();
});
```

### Per-aggregate state table: optimistic concurrency

```ts
it("per-aggregate state table: throws ConcurrencyError on version mismatch", async () => {
  const db = createTestDbWithCustomTables();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    aggregateStates: {
      Order: { table: ordersTable },
    },
  });

  const persistence = adapter.stateStoreFor("Order");
  await persistence.save("Order", "order-1", { status: "placed" }, 0);

  // Try to save with wrong version
  await expect(
    persistence.save("Order", "order-1", { status: "confirmed" }, 0),
  ).rejects.toThrow("ConcurrencyError");
});
```

### Per-aggregate state table: custom column mapping

```ts
const customOrdersTable = sqliteTable("custom_orders", {
  id: text("id").notNull().primaryKey(),
  data: text("data").notNull(),
  ver: integer("ver").notNull().default(0),
});

it("per-aggregate state table: uses custom column mapping", async () => {
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
        columns: {
          aggregateId: customOrdersTable.id,
          state: customOrdersTable.data,
          version: customOrdersTable.ver,
        },
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
```

### Per-aggregate state table: stateStoreFor throws for unknown aggregate

```ts
it("stateStoreFor throws for unconfigured aggregate", () => {
  const db = createTestDbWithCustomTables();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    aggregateStates: {
      Order: { table: ordersTable },
    },
  });

  // TypeScript would catch this at compile time for literal strings,
  // but at runtime it throws for dynamically constructed names
  expect(() => (adapter.stateStoreFor as any)("Payment")).toThrow(
    'No dedicated state table configured for aggregate "Payment"',
  );
});
```

### Per-aggregate state table: participates in UoW transaction

```ts
it("per-aggregate state table: participates in UoW transaction", async () => {
  const db = createTestDbWithCustomTables();
  const adapter = createDrizzleAdapter(db, {
    eventStore: events,
    sagaStore: sagaStates,
    aggregateStates: {
      Order: { table: ordersTable },
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
```

### Adapter: convention-based column resolution fails at creation time

```ts
const badTable = sqliteTable("bad_table", {
  foo: text("foo").notNull(),
  bar: integer("bar").notNull(),
});

it("createDrizzleAdapter throws clear error when convention resolution fails", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(
    `CREATE TABLE bad_table (foo TEXT NOT NULL, bar INTEGER NOT NULL);`,
  );
  const db = drizzle(sqlite);

  // Throws at createDrizzleAdapter call time, not lazily
  expect(() =>
    createDrizzleAdapter(db, {
      eventStore: events,
      sagaStore: sagaStates,
      aggregateStates: {
        Bad: { table: badTable },
      },
    }),
  ).toThrow(/aggregate_id.*state.*version/);
});
```

### Migration generation: default shared tables

```ts
import { generateDrizzleMigration } from "@noddde/drizzle";

it("generates SQL for default shared tables (SQLite)", () => {
  const sql = generateDrizzleMigration("sqlite");

  expect(sql).toContain("CREATE TABLE IF NOT EXISTS noddde_events");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS noddde_aggregate_states");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS noddde_saga_states");
  expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
  expect(sql).not.toContain("noddde_snapshots");
  expect(sql).not.toContain("noddde_outbox");
});
```

### Migration generation: includes optional tables when requested

```ts
it("includes snapshots and outbox tables when requested", () => {
  const sql = generateDrizzleMigration("sqlite", {
    sharedTables: { snapshots: true, outbox: true },
  });

  expect(sql).toContain("CREATE TABLE IF NOT EXISTS noddde_snapshots");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS noddde_outbox");
});
```

### Migration generation: per-aggregate state tables

```ts
it("generates per-aggregate state tables", () => {
  const sql = generateDrizzleMigration("sqlite", {
    aggregateStateTables: {
      Order: { tableName: "orders" },
      BankAccount: {
        tableName: "bank_accounts",
        columns: { aggregateId: "account_id", state: "data", version: "ver" },
      },
    },
  });

  expect(sql).toContain("CREATE TABLE IF NOT EXISTS orders");
  expect(sql).toContain("aggregate_id TEXT NOT NULL PRIMARY KEY");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS bank_accounts");
  expect(sql).toContain("account_id TEXT NOT NULL PRIMARY KEY");
  expect(sql).toContain("data TEXT NOT NULL");
  expect(sql).toContain("ver INTEGER NOT NULL DEFAULT 0");
});
```

### Migration generation: PostgreSQL dialect

```ts
it("generates PostgreSQL-specific DDL", () => {
  const sql = generateDrizzleMigration("postgresql");

  expect(sql).toContain("SERIAL PRIMARY KEY");
  expect(sql).toContain("JSONB NOT NULL");
  expect(sql).toContain("TEXT NOT NULL");
});
```

### Migration generation: MySQL dialect

```ts
it("generates MySQL-specific DDL", () => {
  const sql = generateDrizzleMigration("mysql");

  expect(sql).toContain("INT AUTO_INCREMENT PRIMARY KEY");
  expect(sql).toContain("JSON NOT NULL");
  expect(sql).toContain("VARCHAR(255) NOT NULL");
});
```
