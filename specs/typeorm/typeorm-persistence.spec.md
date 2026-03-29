---
title: "TypeORM Persistence"
module: typeorm/persistence
source_file: packages/adapters/typeorm/src/index.ts
status: implemented
exports:
  - createTypeORMPersistence
  - TypeORMPersistenceInfrastructure
  - TypeORMEventSourcedAggregatePersistence
  - TypeORMStateStoredAggregatePersistence
  - TypeORMSagaPersistence
  - TypeORMSnapshotStore
  - TypeORMAdvisoryLocker
  - TypeORMUnitOfWork
  - TypeORMTransactionStore
  - NodddeEventEntity
  - NodddeAggregateStateEntity
  - NodddeSagaStateEntity
  - NodddeSnapshotEntity
  - TypeORMOutboxStore
  - NodddeOutboxEntryEntity
  - TypeORMAdapter
  - TypeORMAdapterResult
  - TypeORMAggregateStateTableConfig
  - TypeORMStateTableColumnMap
  - generateTypeORMMigration
  - TypeORMMigrationOptions
depends_on:
  - core/persistence/persistence
  - core/persistence/unit-of-work
  - core/persistence/snapshot
  - core/persistence/outbox
docs:
  - running/orm-adapters.mdx
---

# TypeORM Persistence

> TypeORM adapter for noddde providing persistence, advisory locking, and UnitOfWork implementations. The developer provides an initialized TypeORM DataSource instance and registers the provided entity classes; the adapter handles transactions, concurrency control, and entity mapping internally. Supports PostgreSQL, MySQL/MariaDB, and MSSQL for advisory locks; SQLite/better-sqlite3 for persistence only. Internally uses the strategy pattern: each database dialect is a separate `AggregateLocker` implementation, and the public `TypeORMAdvisoryLocker` delegates to the appropriate one.

## Type Contract

```ts
import type { DataSource, EntityManager } from "typeorm";
import type {
  EventSourcedAggregatePersistence,
  PartialEventLoad,
  Snapshot,
  SnapshotStore,
  StateStoredAggregatePersistence,
  SagaPersistence,
  UnitOfWorkFactory,
  AggregateLocker,
} from "@noddde/core";

/**
 * Shared store for propagating the active TypeORM EntityManager
 * (transaction-scoped) to persistence implementations.
 */
export interface TypeORMTransactionStore {
  current: EntityManager | null;
}

/**
 * Result of createTypeORMPersistence.
 */
export interface TypeORMPersistenceInfrastructure {
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  stateStoredPersistence: StateStoredAggregatePersistence;
  sagaPersistence: SagaPersistence;
  snapshotStore: SnapshotStore;
  unitOfWorkFactory: UnitOfWorkFactory;
  outboxStore: OutboxStore;
}

/**
 * Single factory for all TypeORM persistence components.
 *
 * @param dataSource - An initialized TypeORM DataSource.
 */
export function createTypeORMPersistence(
  dataSource: DataSource,
): TypeORMPersistenceInfrastructure;

/**
 * TypeORM-backed event-sourced aggregate persistence.
 */
export class TypeORMEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence, PartialEventLoad
{
  constructor(dataSource: DataSource, txStore: TypeORMTransactionStore);
  save(
    aggregateName: string,
    aggregateId: string,
    events: Event[],
    expectedVersion: number,
  ): Promise<void>;
  load(aggregateName: string, aggregateId: string): Promise<Event[]>;
  loadAfterVersion(
    aggregateName: string,
    aggregateId: string,
    afterVersion: number,
  ): Promise<Event[]>;
}

/**
 * TypeORM-backed outbox store for transactional outbox pattern.
 */
export class TypeORMOutboxStore implements OutboxStore {
  constructor(dataSource: DataSource, txStore: TypeORMTransactionStore);
  save(entries: OutboxEntry[]): Promise<void>;
  loadUnpublished(batchSize?: number): Promise<OutboxEntry[]>;
  markPublished(ids: string[]): Promise<void>;
  markPublishedByEventIds(eventIds: string[]): Promise<void>;
  deletePublished(olderThan?: Date): Promise<void>;
}

/**
 * TypeORM-backed snapshot store for aggregate state snapshots.
 */
export class TypeORMSnapshotStore implements SnapshotStore {
  constructor(dataSource: DataSource, txStore: TypeORMTransactionStore);
  load(aggregateName: string, aggregateId: string): Promise<Snapshot | null>;
  save(
    aggregateName: string,
    aggregateId: string,
    snapshot: Snapshot,
  ): Promise<void>;
}

/**
 * TypeORM-backed state-stored aggregate persistence.
 */
export class TypeORMStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  constructor(dataSource: DataSource, txStore: TypeORMTransactionStore);
  save(
    aggregateName: string,
    aggregateId: string,
    state: any,
    expectedVersion: number,
  ): Promise<void>;
  load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number } | null>;
}

/**
 * TypeORM-backed saga persistence.
 */
export class TypeORMSagaPersistence implements SagaPersistence {
  constructor(dataSource: DataSource, txStore: TypeORMTransactionStore);
  save(sagaName: string, sagaId: string, state: any): Promise<void>;
  load(sagaName: string, sagaId: string): Promise<any | undefined | null>;
}

/**
 * TypeORM-backed UnitOfWork.
 */
export class TypeORMUnitOfWork implements UnitOfWork {
  constructor(dataSource: DataSource, txStore: TypeORMTransactionStore);
  enlist(operation: () => Promise<void>): void;
  deferPublish(...events: Event[]): void;
  commit(): Promise<Event[]>;
  rollback(): Promise<void>;
}

/**
 * Database-backed AggregateLocker using advisory locks via TypeORM.
 * Auto-detects the dialect from dataSource.options.type.
 * Supports postgres (pg_advisory_lock), mysql/mariadb (GET_LOCK),
 * and mssql (sp_getapplock/sp_releaseapplock).
 * SQLite/better-sqlite3 are not supported — throws on construction.
 */
export class TypeORMAdvisoryLocker implements AggregateLocker {
  constructor(dataSource: DataSource);
  acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void>;
  release(aggregateName: string, aggregateId: string): Promise<void>;
}
```

### Entity Exports

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  Index,
} from "typeorm";

/**
 * TypeORM entity for event-sourced aggregate persistence.
 */
@Entity("noddde_events")
@Index(["aggregateName", "aggregateId", "sequenceNumber"], { unique: true })
export class NodddeEventEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: "aggregate_name" })
  aggregateName!: string;

  @Column({ name: "aggregate_id" })
  aggregateId!: string;

  @Column({ name: "sequence_number" })
  sequenceNumber!: number;

  @Column({ name: "event_name" })
  eventName!: string;

  @Column({ type: "text" })
  payload!: string;
}

/**
 * TypeORM entity for state-stored aggregate persistence.
 */
@Entity("noddde_aggregate_states")
export class NodddeAggregateStateEntity {
  @PrimaryColumn({ name: "aggregate_name" })
  aggregateName!: string;

  @PrimaryColumn({ name: "aggregate_id" })
  aggregateId!: string;

  @Column({ type: "text" })
  state!: string;

  @Column({ type: "int", default: 0 })
  version!: number;
}

/**
 * TypeORM entity for saga persistence.
 */
@Entity("noddde_saga_states")
export class NodddeSagaStateEntity {
  @PrimaryColumn({ name: "saga_name" })
  sagaName!: string;

  @PrimaryColumn({ name: "saga_id" })
  sagaId!: string;

  @Column({ type: "text" })
  state!: string;
}

/**
 * TypeORM entity for aggregate state snapshots.
 */
@Entity("noddde_snapshots")
export class NodddeSnapshotEntity {
  @PrimaryColumn({ name: "aggregate_name" })
  aggregateName!: string;

  @PrimaryColumn({ name: "aggregate_id" })
  aggregateId!: string;

  @Column({ type: "text" })
  state!: string;

  @Column({ type: "int" })
  version!: number;
}

/**
 * TypeORM entity for transactional outbox.
 */
@Entity("noddde_outbox")
export class NodddeOutboxEntryEntity {
  @PrimaryColumn()
  id!: string;

  @Column({ type: "text" })
  event!: string;

  @Column({ name: "aggregate_name", nullable: true })
  aggregateName!: string | null;

  @Column({ name: "aggregate_id", nullable: true })
  aggregateId!: string | null;

  @Column({ name: "created_at" })
  createdAt!: string;

  @Column({ name: "published_at", nullable: true })
  publishedAt!: string | null;
}
```

## Behavioral Requirements

### Factory

1. `createTypeORMPersistence(dataSource)` returns a `TypeORMPersistenceInfrastructure` containing all four components: `eventSourcedPersistence`, `stateStoredPersistence`, `sagaPersistence`, and `unitOfWorkFactory`.
2. All four components share a single `TypeORMTransactionStore` so that persistence operations inside a UoW participate in the same transaction context.
3. The factory does not validate entity registration at runtime — missing entities will produce TypeORM errors on first use.

### Event-Sourced Aggregate Persistence

4. `save(aggregateName, aggregateId, events, expectedVersion)` creates `NodddeEventEntity` instances with `sequenceNumber = expectedVersion + index + 1` for each event, then saves them via the repository.
5. `save()` with an empty events array is a no-op (returns immediately).
6. `save()` catches errors whose message matches `/UNIQUE|duplicate|unique/i` (regex) and throws `ConcurrencyError`.
7. `load(aggregateName, aggregateId)` returns events found via `repo.find()` with `order: { sequenceNumber: "ASC" }`, mapping each row to `{ name: row.eventName, payload: JSON.parse(row.payload) }`.
8. `load()` returns `[]` for a nonexistent aggregate.
9. Events are stored with `JSON.stringify(event.payload)` and reconstructed with `JSON.parse(row.payload)`.

### State-Stored Aggregate Persistence

10. `save()` first performs a `findOne` to check for existing state. If found: validates `existing.version === expectedVersion`, updates state and sets `version = expectedVersion + 1`; if version mismatches, throws `ConcurrencyError` with the actual stored version.
11. `save()` on a new aggregate (no existing row): validates `expectedVersion === 0`, creates a new `NodddeAggregateStateEntity` with `version: 1`; if `expectedVersion !== 0`, throws `ConcurrencyError` with `actualVersion: 0`.
12. `load()` uses `repo.findOne()` and returns `{ state: JSON.parse(row.state), version: row.version }`, or `null` if not found.

### Saga Persistence

13. `save()` performs a `findOne` followed by a conditional `create` (if not found) or update (if found), using `JSON.stringify(state)`.
14. `load()` uses `repo.findOne()` and returns `JSON.parse(row.state)`, or `undefined` if not found.
15. Saga persistence has no concurrency control — no version checking on save.

### Advisory Locker

16. Constructor auto-detects dialect from `dataSource.options.type`: `"postgres"` maps to PostgreSQL, `"mysql"` or `"mariadb"` maps to MySQL, `"mssql"` maps to MSSQL. Any other type throws an error at construction time.
17. PostgreSQL: `acquire()` without timeout uses `pg_advisory_lock($1::bigint)` via `dataSource.query()`. With timeout, polls `pg_try_advisory_lock` every 50ms until acquired or deadline exceeded, then throws `LockTimeoutError`.
18. MySQL/MariaDB: `acquire()` uses `GET_LOCK(?, ?)` with timeout in seconds (ceiling of `timeoutMs / 1000`). If `acquired !== 1`, throws `LockTimeoutError`.
19. MSSQL: `acquire()` uses `sp_getapplock` with `@LockMode = 'Exclusive'`, `@LockOwner = 'Session'`, and `@LockTimeout` set to `timeoutMs` (or `-1` for infinite). Return codes `< 0` (timeout, cancelled, deadlock) throw `LockTimeoutError`.
20. `release()` uses `pg_advisory_unlock` (PostgreSQL), `RELEASE_LOCK` (MySQL/MariaDB), or `sp_releaseapplock` (MSSQL) via `dataSource.query()`. MSSQL release is idempotent — releasing an unheld lock is silently ignored.
21. The lock key is derived via `fnv1a64(${aggregateName}:${aggregateId})` for PostgreSQL, the raw composite key truncated to 64 chars for MySQL/MariaDB, or truncated to 255 chars for MSSQL.
22. SQLite/better-sqlite3 are explicitly not supported — constructor throws with a message suggesting `InMemoryAggregateLocker`.

### Unit of Work

23. `enlist(operation)` buffers an async operation for deferred execution.
24. `deferPublish(...events)` accumulates events for post-commit publishing.
25. `commit()` wraps all enlisted operations in `dataSource.manager.transaction(async (transactionalEntityManager) => { ... })`. Sets `txStore.current = transactionalEntityManager` before executing operations, and resets it to `null` in a `finally` block. Returns deferred events on success.
26. `rollback()` discards all operations and events without touching the database.
27. After `commit()` or `rollback()`, further calls to `enlist`, `deferPublish`, `commit`, or `rollback` throw `"UnitOfWork already completed"`.

### Transaction Store

28. All persistence classes use `getManager()` which returns `txStore.current ?? dataSource.manager`, routing operations through the active transaction when inside a UoW.

### Entity Definitions

29. `NodddeEventEntity` maps to table `noddde_events` with a `@PrimaryGeneratedColumn()` id and a unique `@Index` on `[aggregateName, aggregateId, sequenceNumber]`. Columns use `@Column({ name: "snake_case" })` for mapping.
30. `NodddeAggregateStateEntity` maps to table `noddde_aggregate_states` with `@PrimaryColumn` composite key on `[aggregateName, aggregateId]` and a `version` column with `default: 0`.
31. `NodddeSagaStateEntity` maps to table `noddde_saga_states` with `@PrimaryColumn` composite key on `[sagaName, sagaId]`.

### Snapshot Store

32. `TypeORMSnapshotStore.save()` upserts the snapshot using `findOne` + conditional `save` (create if new, update if exists).
33. `TypeORMSnapshotStore.load()` uses `findOne` and returns `{ state: JSON.parse(row.state), version: row.version }`, or `null` if not found.
34. `TypeORMEventSourcedAggregatePersistence.loadAfterVersion()` uses TypeORM's `MoreThan(afterVersion)` operator to load events with `sequenceNumber > afterVersion`, ordered by `sequenceNumber: "ASC"`.
35. `NodddeSnapshotEntity` maps to table `noddde_snapshots` with `@PrimaryColumn` composite key on `[aggregateName, aggregateId]`.
36. Snapshot operations route through `txStore.current` like all other persistence operations.

### Outbox Store

37. `TypeORMOutboxStore.save()` creates `NodddeOutboxEntryEntity` instances with `JSON.stringify(entry.event)` for the event column and saves them via the repository. Runs inside active transaction via `txStore.current`.
38. `TypeORMOutboxStore.loadUnpublished()` returns entries where `publishedAt IS NULL` ordered by `createdAt ASC`, limited by `take: batchSize` (default 100). Deserializes event from JSON.
39. `TypeORMOutboxStore.markPublished()` updates `publishedAt` to current ISO timestamp for entries matching the given IDs.
40. `TypeORMOutboxStore.markPublishedByEventIds()` loads unpublished entries, filters by deserialized `event.metadata.eventId`, and marks matching entries as published.
41. `TypeORMOutboxStore.deletePublished()` removes rows where `publishedAt IS NOT NULL` and optionally `createdAt < olderThan`.
42. Factory always includes `outboxStore` in returned infrastructure.
43. `NodddeOutboxEntryEntity` maps to table `noddde_outbox` with a string `@PrimaryColumn()` id, `text` event column, nullable `aggregate_name` and `aggregate_id`, and `created_at`/`published_at` (nullable) columns.
44. Outbox operations route through `txStore.current` like all other persistence operations.

### Builder

45. `new TypeORMAdapter(dataSource)` creates a builder with no stores configured.
46. `.withEventStore(entity?)` configures the shared events table. Defaults to `NodddeEventEntity`. Required for `build()`.
47. `.withSagaStore(entity?)` configures the shared saga states table. Defaults to `NodddeSagaStateEntity`. Required for `build()`.
48. `.withStateStore(entity?)` configures the shared aggregate states table. Defaults to `NodddeAggregateStateEntity`. Optional — only needed if some aggregates use the shared table.
49. `.withSnapshotStore(entity?)` and `.withOutboxStore(entity?)` are optional. Default to built-in entities.
50. `.withAggregateStateTable(name, config)` registers a dedicated state table for a named aggregate. Config includes `entity` (TypeORM entity class) and optional `columns` mapping.
51. `.build()` throws if `withEventStore` or `withSagaStore` was not called.
52. `.build()` returns a `TypeORMAdapterResult` with all configured stores.
53. All persistence instances from a single builder share the same `TypeORMTransactionStore` so that operations inside a UoW participate in the same transaction.

### Per-Aggregate State Persistence

54. `stateStoreFor(aggregateName)` returns a `StateStoredAggregatePersistence` bound to that aggregate's dedicated TypeORM entity.
55. `stateStoreFor(aggregateName)` throws if no dedicated table was configured for that aggregate via `.withAggregateStateTable()`.
56. The dedicated state persistence ignores the `aggregateName` parameter passed to `save()`/`load()` — the entity table itself is the namespace.
57. The dedicated state persistence uses the column mapping to read/write the correct properties on the TypeORM entity.
58. When `columns` is omitted from `TypeORMAggregateStateTableConfig`, defaults to `{ aggregateId: "aggregateId", state: "state", version: "version" }`.
59. Dedicated state persistence participates in the same UoW transaction as shared persistence via the shared `TypeORMTransactionStore`.
60. `save()` uses `findOne` + version check: if entity exists and version doesn't match, throws `ConcurrencyError`; if entity doesn't exist and `expectedVersion !== 0`, throws `ConcurrencyError`.
61. `load()` uses `findOne` and returns `{ state: JSON.parse(stateValue), version }` or `null`.

### Migration Generation

62. `generateTypeORMMigration(dialect)` returns a SQL string with `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` statements.
63. Default (no options) includes shared tables: `noddde_events`, `noddde_aggregate_states`, `noddde_saga_states`.
64. When `options.sharedTables.snapshots` or `.outbox` is `true`, the corresponding table is included.
65. When `options.aggregateStateTables` is provided, generates `CREATE TABLE IF NOT EXISTS` for each custom table with the configured column names.
66. Output is dialect-aware: PostgreSQL uses `SERIAL`/`JSONB`/`TEXT`, MySQL uses `INT AUTO_INCREMENT`/`JSON`/`VARCHAR(255)`, SQLite uses `INTEGER`/`TEXT`, MSSQL uses `INT IDENTITY(1,1)`/`NVARCHAR(MAX)`/`NVARCHAR(255)`.
67. All DDL statements use `IF NOT EXISTS` for idempotent migrations.

### Backwards Compatibility

68. `createTypeORMPersistence(dataSource)` continues to work with the same signature and return type (`TypeORMPersistenceInfrastructure`).
69. `createTypeORMPersistence` delegates to `TypeORMAdapter` internally (builder wraps the old behavior).
70. The `TypeORMPersistenceInfrastructure` return type is unchanged.
71. `createTypeORMPersistence` is marked `@deprecated` in JSDoc, recommending `TypeORMAdapter` instead.

## Invariants

- [ ] Events saved and loaded maintain FIFO order (sequenceNumber ordering).
- [ ] Different `(aggregateName, aggregateId)` pairs are fully isolated.
- [ ] A committed UoW cannot be reused.
- [ ] Transaction store `current` is `null` outside a UoW boundary.
- [ ] All persistence operations within a UoW execute in the same TypeORM EntityManager transaction.
- [ ] State-stored version increments by exactly 1 on each successful save.
- [ ] Event-sourced save detects concurrent writes via the unique index on `[aggregateName, aggregateId, sequenceNumber]`.
- [ ] Advisory locker constructor rejects unsupported database types immediately.
- [ ] Dedicated state persistence instances share the same txStore as shared persistence.
- [ ] `build()` fails fast if required stores (event, saga) are not configured.
- [ ] `stateStoreFor()` fails fast if aggregate name was not registered.

## Edge Cases

- **First save for a new aggregate**: Event-sourced creates new entity rows with `sequenceNumber` starting at 1. State-stored inserts a new entity with `version: 1`. No prior data exists. `load()` before any save returns `[]` (event-sourced) or `null` (state-stored) or `undefined` (saga).
- **Multiple saves to same aggregate (event-sourced)**: Events append with incrementing sequence numbers. Each save must use the correct `expectedVersion`.
- **Multiple saves to same aggregate (state-stored)**: State is overwritten via entity update; version increments from `expectedVersion` to `expectedVersion + 1`.
- **Empty event array on save**: No-op, no database call.
- **Commit with no enlisted operations**: Succeeds via `transaction()`, returns deferred events (if any).
- **Operation failure mid-commit**: TypeORM transaction rolls back automatically, error propagates.
- **Double commit/rollback**: Throws `"UnitOfWork already completed"`.
- **Transaction store cleared after commit/rollback**: `txStore.current` is always reset to `null` in the `finally` block.
- **Concurrent saves with same expectedVersion**: One succeeds, the other throws `ConcurrencyError` (via unique constraint regex match for event-sourced, or version check for state-stored).
- **Non-zero expectedVersion on new state-stored aggregate**: Throws `ConcurrencyError` with `actualVersion: 0`.
- **Unsupported database type for advisory locker**: Constructor throws immediately with a descriptive error message.
- **MSSQL deadlock victim**: `sp_getapplock` returns `-3` (deadlock victim), treated as `LockTimeoutError`.
- **MSSQL release of unheld lock**: `sp_releaseapplock` raises error 1223; silently caught for idempotency.
- **Outbox save with empty entries array**: No-op, no database call.
- **markPublishedByEventIds with no matches**: No-op, no error.
- **Builder with no event store**: `.build()` throws `"TypeORMAdapter requires withEventStore() to be called before build()"`.
- **Builder with no saga store**: `.build()` throws `"TypeORMAdapter requires withSagaStore() to be called before build()"`.
- **stateStoreFor unknown aggregate**: Throws `"No dedicated state table configured for aggregate \"Foo\". Call .withAggregateStateTable(\"Foo\", ...) before build()."`.
- **Dedicated and shared persistence in same UoW**: Both participate in the same transaction via shared txStore.
- **Multiple dedicated tables in same UoW**: All share the same transaction.
- **Migration generation with empty options**: Returns SQL for all three shared tables.
- **MSSQL dialect in migration**: Uses `INT IDENTITY(1,1)`, `NVARCHAR(MAX)`, `NVARCHAR(255)` types.

## Integration Points

- Persistence implementations satisfy `EventSourcedAggregatePersistence`, `StateStoredAggregatePersistence`, and `SagaPersistence` from `@noddde/core`.
- UoW satisfies `UnitOfWork` from `@noddde/core`.
- Advisory locker satisfies `AggregateLocker` from `@noddde/core`.
- Factory return type matches the infrastructure shape expected by `DomainWiring`.
- Entity classes must be registered in `DataSource.options.entities` for TypeORM to create/manage the tables.
- Outbox store satisfies `OutboxStore` from `@noddde/core`.
- `NodddeOutboxEntryEntity` must be registered in `DataSource.options.entities`.

## Storage Schema (TypeORM Entities)

```
noddde_events
├── id               (auto-increment PK, @PrimaryGeneratedColumn)
├── aggregate_name   (string, NOT NULL)
├── aggregate_id     (string, NOT NULL)
├── sequence_number  (integer, NOT NULL)
├── event_name       (string, NOT NULL)
└── payload          (text, NOT NULL)
UNIQUE INDEX: (aggregate_name, aggregate_id, sequence_number)

noddde_aggregate_states
├── aggregate_name   (string, PK part 1, @PrimaryColumn)
├── aggregate_id     (string, PK part 2, @PrimaryColumn)
├── state            (text, NOT NULL)
└── version          (int, default 0)

noddde_saga_states
├── saga_name        (string, PK part 1, @PrimaryColumn)
├── saga_id          (string, PK part 2, @PrimaryColumn)
└── state            (text, NOT NULL)

noddde_snapshots
├── aggregate_name   (string, PK part 1, @PrimaryColumn)
├── aggregate_id     (string, PK part 2, @PrimaryColumn)
├── state            (text, NOT NULL)
└── version          (int, NOT NULL)

noddde_outbox
├── id               (string, PK, @PrimaryColumn)
├── event            (text, NOT NULL)
├── aggregate_name   (string, nullable)
├── aggregate_id     (string, nullable)
├── created_at       (string, NOT NULL)
└── published_at     (string, nullable)
```

## Test Scenarios

### Event-sourced: save and load roundtrip

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "reflect-metadata";
import { DataSource } from "typeorm";
import { ConcurrencyError } from "@noddde/core";
import { createTypeORMPersistence } from "@noddde/typeorm";
import {
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeOutboxEntryEntity,
} from "@noddde/typeorm";

let dataSource: DataSource;
let infra: ReturnType<typeof createTypeORMPersistence>;

async function setupDb() {
  dataSource = new DataSource({
    type: "better-sqlite3",
    database: ":memory:",
    entities: [
      NodddeEventEntity,
      NodddeAggregateStateEntity,
      NodddeSagaStateEntity,
      NodddeOutboxEntryEntity,
    ],
    synchronize: true,
  });
  await dataSource.initialize();
  infra = createTypeORMPersistence(dataSource);
}

async function teardownDb() {
  if (dataSource?.isInitialized) await dataSource.destroy();
}

describe("TypeORMEventSourcedAggregatePersistence", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load events", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { owner: "Alice" } },
        { name: "DepositMade", payload: { amount: 100 } },
      ],
      0,
    );
    const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(events).toEqual([
      { name: "AccountCreated", payload: { owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 100 } },
    ]);
  });
});
```

### Event-sourced: returns empty array for unknown aggregate

```ts
it("should return empty array for unknown aggregate", async () => {
  const events = await infra.eventSourcedPersistence.load(
    "Account",
    "nonexistent",
  );
  expect(events).toEqual([]);
});
```

### Event-sourced: appends events across multiple saves

```ts
it("should append events across multiple saves", async () => {
  await infra.eventSourcedPersistence.save(
    "Account",
    "acc-1",
    [{ name: "AccountCreated", payload: { owner: "Alice" } }],
    0,
  );
  await infra.eventSourcedPersistence.save(
    "Account",
    "acc-1",
    [{ name: "DepositMade", payload: { amount: 50 } }],
    1,
  );
  const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
  expect(events).toHaveLength(2);
  expect(events[0]!.name).toBe("AccountCreated");
  expect(events[1]!.name).toBe("DepositMade");
});
```

### Event-sourced: isolates by aggregate name

```ts
it("should isolate by aggregate name", async () => {
  await infra.eventSourcedPersistence.save(
    "Order",
    "1",
    [{ name: "OrderPlaced", payload: { total: 200 } }],
    0,
  );
  await infra.eventSourcedPersistence.save(
    "Account",
    "1",
    [{ name: "AccountCreated", payload: { owner: "Bob" } }],
    0,
  );
  const orderEvents = await infra.eventSourcedPersistence.load("Order", "1");
  const accountEvents = await infra.eventSourcedPersistence.load(
    "Account",
    "1",
  );
  expect(orderEvents).toHaveLength(1);
  expect(orderEvents[0]!.name).toBe("OrderPlaced");
  expect(accountEvents).toHaveLength(1);
  expect(accountEvents[0]!.name).toBe("AccountCreated");
});
```

### Event-sourced: throws ConcurrencyError on version mismatch

```ts
it("should throw ConcurrencyError on version mismatch", async () => {
  await infra.eventSourcedPersistence.save(
    "Account",
    "acc-1",
    [{ name: "AccountCreated", payload: { owner: "Alice" } }],
    0,
  );
  await expect(
    infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [{ name: "DepositMade", payload: { amount: 50 } }],
      0,
    ),
  ).rejects.toThrow(ConcurrencyError);
});
```

### State-stored: save and load with version

```ts
describe("TypeORMStateStoredAggregatePersistence", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load state", async () => {
    await infra.stateStoredPersistence.save(
      "Account",
      "acc-1",
      { balance: 100 },
      0,
    );
    const result = await infra.stateStoredPersistence.load("Account", "acc-1");
    expect(result).toEqual({ state: { balance: 100 }, version: 1 });
  });
});
```

### State-stored: returns null for unknown aggregate

```ts
it("should return null for unknown aggregate", async () => {
  const result = await infra.stateStoredPersistence.load(
    "Account",
    "nonexistent",
  );
  expect(result).toBeNull();
});
```

### State-stored: overwrites state and increments version

```ts
it("should overwrite state on repeated saves", async () => {
  await infra.stateStoredPersistence.save(
    "Account",
    "acc-1",
    { balance: 100 },
    0,
  );
  await infra.stateStoredPersistence.save(
    "Account",
    "acc-1",
    { balance: 200 },
    1,
  );
  const result = await infra.stateStoredPersistence.load("Account", "acc-1");
  expect(result).toEqual({ state: { balance: 200 }, version: 2 });
});
```

### State-stored: throws ConcurrencyError on version mismatch

```ts
it("should throw ConcurrencyError when expectedVersion mismatches stored version", async () => {
  await infra.stateStoredPersistence.save(
    "Account",
    "acc-1",
    { balance: 100 },
    0,
  );
  await expect(
    infra.stateStoredPersistence.save("Account", "acc-1", { balance: 200 }, 0),
  ).rejects.toThrow(ConcurrencyError);
});
```

### State-stored: throws ConcurrencyError for non-zero expectedVersion on new aggregate

```ts
it("should throw ConcurrencyError when expectedVersion is non-zero for new aggregate", async () => {
  await expect(
    infra.stateStoredPersistence.save(
      "Account",
      "acc-new",
      { balance: 100 },
      5,
    ),
  ).rejects.toThrow(ConcurrencyError);
});
```

### Saga: save and load roundtrip

```ts
describe("TypeORMSagaPersistence", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load saga state", async () => {
    await infra.sagaPersistence.save("Fulfillment", "o-1", {
      status: "pending",
    });
    const state = await infra.sagaPersistence.load("Fulfillment", "o-1");
    expect(state).toEqual({ status: "pending" });
  });
});
```

### Saga: returns undefined for unknown saga

```ts
it("should return undefined for unknown saga", async () => {
  const state = await infra.sagaPersistence.load("Fulfillment", "nonexistent");
  expect(state == null).toBe(true);
});
```

### Saga: overwrites state on repeated saves

```ts
it("should overwrite state on repeated saves", async () => {
  await infra.sagaPersistence.save("Fulfillment", "o-1", { step: 1 });
  await infra.sagaPersistence.save("Fulfillment", "o-1", { step: 2 });
  const state = await infra.sagaPersistence.load("Fulfillment", "o-1");
  expect(state).toEqual({ step: 2 });
});
```

### UoW: commits all operations in a transaction

```ts
describe("TypeORMUnitOfWork", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should commit all operations in a real database transaction", async () => {
    const uow = infra.unitOfWorkFactory();
    uow.enlist(() =>
      infra.eventSourcedPersistence.save(
        "Account",
        "acc-1",
        [{ name: "AccountCreated", payload: { owner: "Alice" } }],
        0,
      ),
    );
    uow.enlist(() =>
      infra.sagaPersistence.save("Fulfillment", "o-1", { step: 1 }),
    );
    uow.deferPublish({ name: "AccountCreated", payload: { owner: "Alice" } });

    const events = await uow.commit();
    expect(events).toHaveLength(1);

    const loaded = await infra.eventSourcedPersistence.load("Account", "acc-1");
    expect(loaded).toHaveLength(1);
    const sagaState = await infra.sagaPersistence.load("Fulfillment", "o-1");
    expect(sagaState).toEqual({ step: 1 });
  });
});
```

### UoW: rollback discards everything

```ts
it("should rollback without persisting anything", async () => {
  const uow = infra.unitOfWorkFactory();
  uow.enlist(() =>
    infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [{ name: "AccountCreated", payload: { owner: "Alice" } }],
      0,
    ),
  );
  await uow.rollback();
  const events = await infra.eventSourcedPersistence.load("Account", "acc-1");
  expect(events).toEqual([]);
});
```

### Snapshot store: save and load roundtrip

```ts
describe("TypeORMSnapshotStore", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load a snapshot", async () => {
    await infra.snapshotStore.save("Account", "acc-1", {
      state: { balance: 500 },
      version: 10,
    });
    const snapshot = await infra.snapshotStore.load("Account", "acc-1");
    expect(snapshot).toEqual({ state: { balance: 500 }, version: 10 });
  });
});
```

### Snapshot store: returns null for unknown aggregate

```ts
it("should return null for unknown aggregate", async () => {
  const snapshot = await infra.snapshotStore.load("Account", "nonexistent");
  expect(snapshot).toBeNull();
});
```

### Snapshot store: overwrites on repeated saves

```ts
it("should overwrite snapshot on repeated saves", async () => {
  await infra.snapshotStore.save("Account", "acc-1", {
    state: { balance: 100 },
    version: 5,
  });
  await infra.snapshotStore.save("Account", "acc-1", {
    state: { balance: 300 },
    version: 15,
  });
  const snapshot = await infra.snapshotStore.load("Account", "acc-1");
  expect(snapshot).toEqual({ state: { balance: 300 }, version: 15 });
});
```

### Snapshot store: isolates by aggregate name and id

```ts
it("should isolate snapshots by aggregate name and id", async () => {
  await infra.snapshotStore.save("Order", "1", {
    state: { total: 200 },
    version: 3,
  });
  await infra.snapshotStore.save("Account", "1", {
    state: { balance: 100 },
    version: 7,
  });
  const orderSnapshot = await infra.snapshotStore.load("Order", "1");
  const accountSnapshot = await infra.snapshotStore.load("Account", "1");
  expect(orderSnapshot).toEqual({ state: { total: 200 }, version: 3 });
  expect(accountSnapshot).toEqual({ state: { balance: 100 }, version: 7 });
});
```

### loadAfterVersion: loads events after a given version

```ts
describe("TypeORMEventSourcedAggregatePersistence (loadAfterVersion)", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should load events after a given version", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { owner: "Alice" } },
        { name: "DepositMade", payload: { amount: 100 } },
        { name: "DepositMade", payload: { amount: 50 } },
      ],
      0,
    );
    const persistence =
      infra.eventSourcedPersistence as TypeORMEventSourcedAggregatePersistence;
    const events = await persistence.loadAfterVersion("Account", "acc-1", 1);
    expect(events).toHaveLength(2);
    expect(events[0]!.name).toBe("DepositMade");
  });
});
```

### loadAfterVersion: returns all events when afterVersion is 0

```ts
it("should return all events when afterVersion is 0", async () => {
  await infra.eventSourcedPersistence.save(
    "Account",
    "acc-1",
    [
      { name: "AccountCreated", payload: { owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 100 } },
    ],
    0,
  );
  const persistence =
    infra.eventSourcedPersistence as TypeORMEventSourcedAggregatePersistence;
  const events = await persistence.loadAfterVersion("Account", "acc-1", 0);
  expect(events).toHaveLength(2);
});
```

### loadAfterVersion: returns empty array when afterVersion >= stream length

```ts
it("should return empty array when afterVersion >= stream length", async () => {
  await infra.eventSourcedPersistence.save(
    "Account",
    "acc-1",
    [{ name: "AccountCreated", payload: { owner: "Alice" } }],
    0,
  );
  const persistence =
    infra.eventSourcedPersistence as TypeORMEventSourcedAggregatePersistence;
  const events = await persistence.loadAfterVersion("Account", "acc-1", 10);
  expect(events).toEqual([]);
});
```

### Outbox store: save and load unpublished entries

```ts
import { NodddeOutboxEntryEntity } from "@noddde/typeorm";
// Note: NodddeOutboxEntryEntity must be added to the setupDb entities array.

describe("TypeORMOutboxStore", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load unpublished entries", async () => {
    await infra.outboxStore.save([
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

    const unpublished = await infra.outboxStore.loadUnpublished();
    expect(unpublished).toHaveLength(1);
    expect(unpublished[0]!.event.name).toBe("OrderPlaced");
    expect(unpublished[0]!.publishedAt).toBeNull();
  });
});
```

### Outbox store: markPublished sets publishedAt

```ts
it("should mark entries as published", async () => {
  await infra.outboxStore.save([
    {
      id: "entry-1",
      event: { name: "OrderPlaced", payload: {} },
      createdAt: "2024-01-01T00:00:00.000Z",
      publishedAt: null,
    },
  ]);

  await infra.outboxStore.markPublished(["entry-1"]);
  const unpublished = await infra.outboxStore.loadUnpublished();
  expect(unpublished).toHaveLength(0);
});
```

### Outbox store: markPublishedByEventIds matches on event metadata

```ts
it("should mark entries as published by event IDs", async () => {
  await infra.outboxStore.save([
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

  await infra.outboxStore.markPublishedByEventIds(["evt-1"]);
  const unpublished = await infra.outboxStore.loadUnpublished();
  expect(unpublished).toHaveLength(1);
  expect(unpublished[0]!.id).toBe("entry-2");
});
```

### Outbox store: deletePublished removes only published entries

```ts
it("should delete only published entries", async () => {
  await infra.outboxStore.save([
    {
      id: "entry-1",
      event: { name: "OrderPlaced", payload: {} },
      createdAt: "2024-01-01T00:00:00.000Z",
      publishedAt: null,
    },
  ]);
  await infra.outboxStore.markPublished(["entry-1"]);
  await infra.outboxStore.deletePublished();
  const unpublished = await infra.outboxStore.loadUnpublished();
  expect(unpublished).toHaveLength(0);
});
```

### Outbox store: save within UoW transaction

```ts
it("should save outbox entries within a UoW transaction", async () => {
  const uow = infra.unitOfWorkFactory();
  uow.enlist(() =>
    infra.outboxStore.save([
      {
        id: "entry-1",
        event: { name: "OrderPlaced", payload: { total: 50 } },
        createdAt: "2024-01-01T00:00:00.000Z",
        publishedAt: null,
      },
    ]),
  );
  uow.enlist(() =>
    infra.eventSourcedPersistence.save(
      "Order",
      "o-1",
      [{ name: "OrderPlaced", payload: { total: 50 } }],
      0,
    ),
  );

  await uow.commit();

  const unpublished = await infra.outboxStore.loadUnpublished();
  expect(unpublished).toHaveLength(1);
  const events = await infra.eventSourcedPersistence.load("Order", "o-1");
  expect(events).toHaveLength(1);
});
```
