---
title: "Prisma Persistence"
module: prisma/persistence
source_file: packages/adapters/prisma/src/index.ts
status: implemented
exports:
  - PrismaAdapter
  - createPrismaAdapter (deprecated)
  - PrismaAdapterConfig (deprecated)
  - PrismaAdapterResult (deprecated)
  - PrismaAggregateStateTableConfig
  - PrismaStateTableColumnMap
  - createPrismaPersistence
  - PrismaPersistenceInfrastructure
  - PrismaEventSourcedAggregatePersistence
  - PrismaStateStoredAggregatePersistence
  - PrismaSagaPersistence
  - PrismaSnapshotStore
  - PrismaAdvisoryLocker
  - PrismaUnitOfWork
  - PrismaTransactionStore
  - PrismaOutboxStore
  - createPrismaUnitOfWorkFactory
depends_on:
  - core/persistence/persistence
  - core/persistence/unit-of-work
  - core/persistence/snapshot
  - core/persistence/outbox
  - core/persistence/adapter
docs:
  - running/orm-adapters.mdx
---

# Prisma Persistence

> Prisma ORM adapter for noddde providing persistence, advisory locking, and UnitOfWork implementations. The developer provides a PrismaClient instance; the adapter handles schema mapping, transactions, and concurrency control internally. Supports PostgreSQL, MySQL, and MariaDB for advisory locks; SQLite for persistence only. Internally uses the strategy pattern: each database dialect is a separate `AggregateLocker` implementation, and the public `PrismaAdvisoryLocker` delegates to the appropriate one.

## Type Contract

```ts
import type { PrismaClient } from "@prisma/client";
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  UnitOfWorkFactory,
  AggregateLocker,
  SnapshotStore,
  Snapshot,
  PartialEventLoad,
  OutboxStore,
  OutboxEntry,
} from "@noddde/core";

/**
 * Shared store for propagating the active Prisma transaction client
 * to persistence implementations.
 */
export interface PrismaTransactionStore {
  current: any | null;
}

/**
 * Column mapping for a custom state-stored aggregate table in Prisma.
 * Maps logical noddde columns to Prisma model property names.
 * Defaults: `{ aggregateId: "aggregateId", state: "state", version: "version" }`.
 */
export interface PrismaStateTableColumnMap {
  aggregateId: string;
  state: string;
  version: string;
}

/**
 * Configuration for a per-aggregate state table in Prisma.
 */
export interface PrismaAggregateStateTableConfig {
  /** Prisma model name (camelCase as used in PrismaClient, e.g., "order"). */
  model: string;
  /** Column mappings. If omitted, uses defaults: aggregateId, state, version. */
  columns?: Partial<PrismaStateTableColumnMap>;
}

/**
 * Configuration for createPrismaAdapter.
 *
 * Event store, state store, and saga store are always created (built-in Prisma models).
 * Optional stores (snapshot, outbox) and per-aggregate tables are configured here.
 */
export interface PrismaAdapterConfig {
  /** Enable the snapshot store (NodddeSnapshot model). Optional. */
  snapshotStore?: true;
  /** Enable the outbox store (NodddeOutboxEntry model). Optional. */
  outboxStore?: true;
  /** Per-aggregate dedicated state tables with custom column mappings. Optional. */
  aggregateStates?: Record<string, PrismaAggregateStateTableConfig>;
}

/**
 * Result of createPrismaAdapter. The type narrows based on which
 * optional stores were configured — configured stores appear as non-optional.
 *
 * Event store, state store, saga store, and UoW are always present.
 *
 * @typeParam C - The adapter config, inferred from the call site.
 */
export type PrismaAdapterResult<C extends PrismaAdapterConfig> = {
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  stateStoredPersistence: StateStoredAggregatePersistence;
  sagaPersistence: SagaPersistence;
  unitOfWorkFactory: UnitOfWorkFactory;
} & (C extends { snapshotStore: true }
  ? { snapshotStore: SnapshotStore }
  : {}) &
  (C extends { outboxStore: true } ? { outboxStore: OutboxStore } : {}) &
  (C extends { aggregateStates: Record<string, any> }
    ? {
        stateStoreFor(
          name: keyof C["aggregateStates"] & string,
        ): StateStoredAggregatePersistence;
      }
    : {});

/**
 * Creates a fully-configured Prisma persistence adapter.
 *
 * Event store, state store, saga store, and UoW are always created (built-in
 * Prisma models). The config controls optional stores and per-aggregate tables.
 *
 * @param prisma - A PrismaClient instance.
 * @param config - Optional adapter configuration for snapshots, outbox, and per-aggregate tables.
 * @returns Typed persistence infrastructure.
 */
export function createPrismaAdapter(
  prisma: PrismaClient,
): PrismaAdapterResult<{}>;
export function createPrismaAdapter<const C extends PrismaAdapterConfig>(
  prisma: PrismaClient,
  config: C,
): PrismaAdapterResult<C>;

/**
 * Result of createPrismaPersistence (deprecated).
 */
export interface PrismaPersistenceInfrastructure {
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  stateStoredPersistence: StateStoredAggregatePersistence;
  sagaPersistence: SagaPersistence;
  snapshotStore: SnapshotStore;
  unitOfWorkFactory: UnitOfWorkFactory;
  outboxStore: OutboxStore;
}

/**
 * @deprecated Use createPrismaAdapter instead.
 * Preserved for backwards compatibility; delegates to createPrismaAdapter internally.
 *
 * @param prisma - A PrismaClient instance.
 */
export function createPrismaPersistence(
  prisma: PrismaClient,
): PrismaPersistenceInfrastructure;

/**
 * Prisma-backed event-sourced aggregate persistence.
 */
export class PrismaEventSourcedAggregatePersistence
  implements EventSourcedAggregatePersistence, PartialEventLoad
{
  constructor(prisma: PrismaClient, txStore: PrismaTransactionStore);
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
 * Prisma-backed state-stored aggregate persistence.
 */
export class PrismaStateStoredAggregatePersistence
  implements StateStoredAggregatePersistence
{
  constructor(prisma: PrismaClient, txStore: PrismaTransactionStore);
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
 * Prisma-backed saga persistence.
 */
export class PrismaSagaPersistence implements SagaPersistence {
  constructor(prisma: PrismaClient, txStore: PrismaTransactionStore);
  save(sagaName: string, sagaId: string, state: any): Promise<void>;
  load(sagaName: string, sagaId: string): Promise<any | undefined | null>;
}

/**
 * Prisma-backed UnitOfWork.
 */
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(prisma: PrismaClient, txStore: PrismaTransactionStore);
  enlist(operation: () => Promise<void>): void;
  deferPublish(...events: Event[]): void;
  commit(): Promise<Event[]>;
  rollback(): Promise<void>;
}

/**
 * Database-backed AggregateLocker using advisory locks via Prisma.
 * Supports PostgreSQL (pg_advisory_lock), MySQL (GET_LOCK),
 * and MariaDB (GET_LOCK, same as MySQL).
 * SQLite is not supported.
 */
export class PrismaAdvisoryLocker implements AggregateLocker {
  constructor(
    prisma: PrismaClient,
    dialect: "postgresql" | "mysql" | "mariadb",
  );
  acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void>;
  release(aggregateName: string, aggregateId: string): Promise<void>;
}

/**
 * Prisma-backed snapshot store for event-sourced aggregate state snapshotting.
 */
export class PrismaSnapshotStore implements SnapshotStore {
  constructor(prisma: PrismaClient, txStore: PrismaTransactionStore);
  load(aggregateName: string, aggregateId: string): Promise<Snapshot | null>;
  save(
    aggregateName: string,
    aggregateId: string,
    snapshot: Snapshot,
  ): Promise<void>;
}

/**
 * Prisma-backed outbox store for transactional outbox pattern.
 */
export class PrismaOutboxStore implements OutboxStore {
  constructor(prisma: PrismaClient, txStore: PrismaTransactionStore);
  save(entries: OutboxEntry[]): Promise<void>;
  loadUnpublished(batchSize?: number): Promise<OutboxEntry[]>;
  markPublished(ids: string[]): Promise<void>;
  markPublishedByEventIds(eventIds: string[]): Promise<void>;
  deletePublished(olderThan?: Date): Promise<void>;
}
```

## Behavioral Requirements

### Factory (`createPrismaAdapter`)

1. `createPrismaAdapter(prisma)` (no config) returns a `PrismaAdapterResult<{}>` containing: `eventSourcedPersistence`, `stateStoredPersistence`, `sagaPersistence`, and `unitOfWorkFactory`. Event store, state store, and saga store are always created (built-in Prisma models).
2. `createPrismaAdapter(prisma, config)` (with config) returns a `PrismaAdapterResult<C>` whose type narrows based on the config: `snapshotStore` and `outboxStore` appear only if configured as `true`; `stateStoreFor()` appears only if `aggregateStates` is provided.
3. All persistence instances share a single `PrismaTransactionStore` so that persistence operations inside a UoW participate in the same transaction context.
   3a. The factory does not validate schema presence for built-in models at runtime — missing Prisma models will produce runtime errors on first use.

### Event-Sourced Aggregate Persistence

4. `save(aggregateName, aggregateId, events, expectedVersion)` appends events with `createMany`, assigning `sequenceNumber = expectedVersion + index + 1` for each event. The `created_at` column is set from `event.metadata.timestamp` (parsed to a Date), falling back to `new Date()` if metadata is absent.
5. `save()` with an empty events array is a no-op (returns immediately).
6. `save()` catches Prisma error code `P2002` (unique constraint violation on `[aggregateName, aggregateId, sequenceNumber]`) and throws `ConcurrencyError`.
7. `load(aggregateName, aggregateId)` returns events ordered by `sequenceNumber: "asc"`, with `JSON.parse(row.payload)` for each event.
8. `load()` returns `[]` for a nonexistent aggregate.
9. Events are stored with `JSON.stringify(event.payload)` and reconstructed as `{ name: row.eventName, payload: JSON.parse(row.payload) }`.

### State-Stored Aggregate Persistence

10. `save()` with `expectedVersion === 0` performs a `create` with `version: 1`. If `P2002` is thrown (aggregate already exists), it throws `ConcurrencyError`.
11. `save()` with `expectedVersion > 0` performs an `updateMany` where `version === expectedVersion`, setting `version = expectedVersion + 1`. If `result.count === 0` (no matching row), it throws `ConcurrencyError`.
12. `load()` uses `findUnique` on the composite key `aggregateName_aggregateId` and returns `{ state: JSON.parse(row.state), version: row.version }`, or `null` if not found.

### Saga Persistence

13. `save()` performs a `findUnique` followed by a conditional `create` (if not found) or `update` (if found), using `JSON.stringify(state)`.
14. `load()` uses `findUnique` on the composite key `sagaName_sagaId` and returns `JSON.parse(row.state)`, or `undefined` if not found.
15. Saga persistence has no concurrency control — no version checking on save.

### Advisory Locker

16. PostgreSQL: `acquire()` without timeout uses `pg_advisory_lock($1::bigint)` via `$queryRawUnsafe`. With timeout, polls `pg_try_advisory_lock` every 50ms until acquired or deadline exceeded, then throws `LockTimeoutError`.
17. MySQL/MariaDB: `acquire()` uses `GET_LOCK(?, ?)` with timeout in seconds (ceiling of `timeoutMs / 1000`). If `acquired !== 1n`, throws `LockTimeoutError`. MariaDB follows the same code path as MySQL.
18. `release()` uses `pg_advisory_unlock` (PostgreSQL) or `RELEASE_LOCK` (MySQL/MariaDB).
19. The lock key is derived via `fnv1a64(${aggregateName}:${aggregateId})` for PostgreSQL, or the raw composite key (truncated to 64 chars) for MySQL/MariaDB.
20. Unsupported dialects throw at construction time with a message suggesting `InMemoryAggregateLocker`.

### Unit of Work

21. `enlist(operation)` buffers an async operation for deferred execution.
22. `deferPublish(...events)` accumulates events for post-commit publishing.
23. `commit()` wraps all enlisted operations in a `prisma.$transaction(async (tx) => { ... })` callback. Sets `txStore.current = tx` before executing operations, and resets it to `null` in a `finally` block. Returns deferred events on success.
24. `rollback()` discards all operations and events without touching the database.
25. After `commit()` or `rollback()`, further calls to `enlist`, `deferPublish`, `commit`, or `rollback` throw `"UnitOfWork already completed"`.

### Transaction Store

26. All persistence classes use `getExecutor()` which returns `txStore.current ?? prisma`, routing operations through the active transaction when inside a UoW.

### Snapshot Store

27. `PrismaSnapshotStore.save()` upserts the snapshot using `findUnique` + conditional `create`/`update` on the `NodddeSnapshot` model.
28. `PrismaSnapshotStore.load()` uses `findUnique` on the composite key and returns `{ state: JSON.parse(row.state), version: row.version }`, or `null` if not found.
29. `PrismaEventSourcedAggregatePersistence.loadAfterVersion()` loads events with `sequenceNumber: { gt: afterVersion }` ordered by `sequenceNumber: "asc"`.
30. Snapshot operations route through `txStore.current` like all other persistence operations.

### Outbox Store

31. `PrismaOutboxStore.save()` inserts entries with `JSON.stringify(entry.event)` for the event column via `createMany`. Runs inside active transaction via `txStore.current`.
32. `PrismaOutboxStore.loadUnpublished()` returns entries where `publishedAt: null` ordered by `createdAt: "asc"`, limited by `take: batchSize` (default 100). Deserializes event from JSON.
33. `PrismaOutboxStore.markPublished()` updates `publishedAt` to the current timestamp (`new Date()`) for entries matching the given IDs via `updateMany`.
34. `PrismaOutboxStore.markPublishedByEventIds()` loads unpublished entries, filters by deserialized `event.metadata.eventId`, and marks matching entries as published.
35. `PrismaOutboxStore.deletePublished()` deletes rows where `publishedAt` is not null and optionally `createdAt < olderThan` via `deleteMany`.
36. `outboxStore` is only present in the result when `config.outboxStore` is `true`. Same for `snapshotStore`.
37. Outbox operations route through `txStore.current` like all other persistence operations.

### Config-Based Adapter

38. `createPrismaAdapter(prisma)` with no config always returns event-sourced, state-stored, and saga persistence plus `unitOfWorkFactory`.
39. `createPrismaAdapter(prisma, { snapshotStore: true })` includes `snapshotStore` in the result.
40. `createPrismaAdapter(prisma, { outboxStore: true })` includes `outboxStore` in the result.
41. `createPrismaAdapter(prisma, { aggregateStates: { ... } })` includes `stateStoreFor()` in the result.
42. The config shape `PrismaAdapterConfig` has optional fields: `snapshotStore?: true`, `outboxStore?: true`, `aggregateStates?: Record<string, PrismaAggregateStateTableConfig>`.
43. `PrismaAggregateStateTableConfig` has `model` (required) and `columns?: Partial<PrismaStateTableColumnMap>`.
44. `createPrismaAdapter` validates that each configured aggregate state model delegate exists on the PrismaClient instance at creation time. Throws if not found.
45. The return type `PrismaAdapterResult<C>` uses TypeScript conditional types to narrow based on config — configured optional stores appear as non-optional properties.
46. All persistence instances from a single `createPrismaAdapter` call share the same `PrismaTransactionStore` so that operations inside a UoW participate in the same transaction.

### Per-Aggregate State Persistence

48. `stateStoreFor(aggregateName)` returns a `StateStoredAggregatePersistence` bound to that aggregate's dedicated Prisma model.
49. `stateStoreFor(aggregateName)` throws if no dedicated table was configured for that aggregate in the `aggregateStates` config.
50. The dedicated state persistence ignores the `aggregateName` parameter passed to `save()`/`load()` — the model itself is the namespace.
51. The dedicated state persistence uses the column mapping to read/write the correct properties on the Prisma model.
52. When `columns` is omitted from `PrismaAggregateStateTableConfig`, defaults to `{ aggregateId: "aggregateId", state: "state", version: "version" }`.
53. Dedicated state persistence participates in the same UoW transaction as shared persistence via the shared `PrismaTransactionStore`.
54. `save()` with `expectedVersion === 0` uses `create()`; catches Prisma `P2002` (unique constraint violation) and rethrows as `ConcurrencyError`.
55. `save()` with `expectedVersion > 0` uses `updateMany()` with version match; throws `ConcurrencyError` if `count === 0`.

### Backwards Compatibility

56. `createPrismaPersistence(prisma)` continues to work with the same signature and return type (`PrismaPersistenceInfrastructure`).
57. `createPrismaPersistence` delegates to `createPrismaAdapter` internally with `{ snapshotStore: true, outboxStore: true }`.
58. The `PrismaPersistenceInfrastructure` return type is unchanged.
59. `createPrismaPersistence` is marked `@deprecated` in JSDoc, recommending `createPrismaAdapter` instead.

## Invariants

- [ ] Events saved and loaded maintain FIFO order (sequenceNumber ordering).
- [ ] Different `(aggregateName, aggregateId)` pairs are fully isolated.
- [ ] A committed UoW cannot be reused.
- [ ] Transaction store `current` is `null` outside a UoW boundary.
- [ ] All persistence operations within a UoW execute in the same Prisma interactive transaction.
- [ ] State-stored version increments by exactly 1 on each successful save.
- [ ] Event-sourced save detects concurrent writes via the `@@unique` constraint.
- [ ] Dedicated state persistence instances share the same txStore as shared persistence.
- [ ] `createPrismaAdapter` validates configured aggregate state model delegates at creation time.
- [ ] `stateStoreFor()` fails fast if aggregate name was not registered in the config.

## Edge Cases

- **First save for a new aggregate**: Event-sourced creates new rows with `sequenceNumber` starting at 1. State-stored inserts with `version: 1`. No prior data exists. `load()` before any save returns `[]` (event-sourced) or `null` (state-stored) or `undefined` (saga).
- **Multiple saves to same aggregate (event-sourced)**: Events append with incrementing sequence numbers. Each save must use the correct `expectedVersion`.
- **Multiple saves to same aggregate (state-stored)**: State is overwritten; version increments from `expectedVersion` to `expectedVersion + 1`.
- **Empty event array on save**: No-op, no database call.
- **Outbox save with empty entries array**: No-op, no database call.
- **markPublishedByEventIds with no matches**: No-op, no error.
- **Commit with no enlisted operations**: Succeeds via `$transaction`, returns deferred events (if any).
- **Operation failure mid-commit**: Prisma transaction rolls back automatically, error propagates.
- **Double commit/rollback**: Throws `"UnitOfWork already completed"`.
- **Transaction store cleared after commit/rollback**: `txStore.current` is always reset to `null` in the `finally` block.
- **Concurrent saves with same expectedVersion**: One succeeds, the other throws `ConcurrencyError` (via `P2002` for event-sourced or `count === 0` for state-stored).
- **Invalid aggregate state model**: `createPrismaAdapter(prisma, { aggregateStates: { Foo: { model: "nonexistent" } } })` throws `'Prisma model "nonexistent" not found on PrismaClient for aggregate "Foo"...'`.
- **stateStoreFor unknown aggregate**: Throws `'No dedicated state table configured for aggregate "Foo". Add "Foo" to the aggregateStates config.'`.
- **Dedicated and shared persistence in same UoW**: Both participate in the same transaction via shared txStore.
- **Multiple dedicated tables in same UoW**: All share the same transaction.
- **No config (minimal call)**: `createPrismaAdapter(prisma)` returns only always-present stores; no `snapshotStore`, `outboxStore`, or `stateStoreFor`.

## Integration Points

- Persistence implementations satisfy `EventSourcedAggregatePersistence`, `StateStoredAggregatePersistence`, and `SagaPersistence` from `@noddde/core`.
- UoW satisfies `UnitOfWork` from `@noddde/core`.
- Advisory locker satisfies `AggregateLocker` from `@noddde/core`.
- Factory return type matches the infrastructure shape expected by `DomainWiring`.
- Snapshot store satisfies `SnapshotStore` from `@noddde/core`.
- Event-sourced persistence also satisfies `PartialEventLoad` from `@noddde/core`.
- Outbox store satisfies `OutboxStore` from `@noddde/core`.
- Requires a Prisma schema with `NodddeEvent`, `NodddeAggregateState`, `NodddeSagaState`, and `NodddeSnapshot` models.

## Storage Schema (Prisma)

```prisma
model NodddeEvent {
  id             Int      @id @default(autoincrement())
  aggregateName  String   @map("aggregate_name")
  aggregateId    String   @map("aggregate_id")
  sequenceNumber Int      @map("sequence_number")
  eventName      String   @map("event_name")
  payload        String
  metadata       String?
  createdAt      DateTime @map("created_at")

  @@unique([aggregateName, aggregateId, sequenceNumber])
  @@map("noddde_events")
}

model NodddeAggregateState {
  aggregateName String @map("aggregate_name")
  aggregateId   String @map("aggregate_id")
  state         String
  version       Int    @default(0)

  @@id([aggregateName, aggregateId])
  @@map("noddde_aggregate_states")
}

model NodddeSagaState {
  sagaName String @map("saga_name")
  sagaId   String @map("saga_id")
  state    String

  @@id([sagaName, sagaId])
  @@map("noddde_saga_states")
}

model NodddeSnapshot {
  aggregateName String @map("aggregate_name")
  aggregateId   String @map("aggregate_id")
  state         String
  version       Int

  @@id([aggregateName, aggregateId])
  @@map("noddde_snapshots")
}

model NodddeOutboxEntry {
  id            String    @id
  event         String
  aggregateName String?   @map("aggregate_name")
  aggregateId   String?   @map("aggregate_id")
  createdAt     DateTime  @map("created_at")
  publishedAt   DateTime? @map("published_at")

  @@map("noddde_outbox")
}
```

## Test Scenarios

### Event-sourced: save and load roundtrip

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { ConcurrencyError } from "@noddde/core";
import { createPrismaAdapter } from "@noddde/prisma";

const TEST_DB = path.resolve(__dirname, "../../prisma/test.db");
const DATABASE_URL = `file:${TEST_DB}`;

let prisma: PrismaClient;
let infra: ReturnType<
  typeof createPrismaAdapter<{ snapshotStore: true; outboxStore: true }>
>;

async function setupDb() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, DATABASE_URL },
    stdio: "pipe",
  });
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();
  infra = createPrismaAdapter(prisma, {
    snapshotStore: true,
    outboxStore: true,
  });
}

async function teardownDb() {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
}

describe("PrismaEventSourcedAggregatePersistence", () => {
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
  expect(accountEvents).toHaveLength(1);
});
```

### Event-sourced: throws ConcurrencyError on duplicate sequence number

```ts
it("should throw ConcurrencyError on duplicate sequence number", async () => {
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
describe("PrismaStateStoredAggregatePersistence", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load state with version", async () => {
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
it("should overwrite state on repeated saves and increment version", async () => {
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
it("should throw ConcurrencyError on version mismatch", async () => {
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

### Saga: save and load roundtrip

```ts
describe("PrismaSagaPersistence", () => {
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
describe("PrismaUnitOfWork", () => {
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
describe("PrismaSnapshotStore", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should save and load a snapshot", async () => {
    await infra.snapshotStore.save("Account", "acc-1", {
      state: { balance: 500 },
      version: 5,
    });
    const snapshot = await infra.snapshotStore.load("Account", "acc-1");
    expect(snapshot).toEqual({ state: { balance: 500 }, version: 5 });
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
    version: 2,
  });
  await infra.snapshotStore.save("Account", "acc-1", {
    state: { balance: 500 },
    version: 5,
  });
  const snapshot = await infra.snapshotStore.load("Account", "acc-1");
  expect(snapshot).toEqual({ state: { balance: 500 }, version: 5 });
});
```

### Snapshot store: isolates by aggregate name

```ts
it("should isolate snapshots by aggregate name", async () => {
  await infra.snapshotStore.save("Account", "1", {
    state: { balance: 100 },
    version: 2,
  });
  await infra.snapshotStore.save("Order", "1", {
    state: { total: 200 },
    version: 3,
  });
  const account = await infra.snapshotStore.load("Account", "1");
  const order = await infra.snapshotStore.load("Order", "1");
  expect(account).toEqual({ state: { balance: 100 }, version: 2 });
  expect(order).toEqual({ state: { total: 200 }, version: 3 });
});
```

### Event-sourced: loadAfterVersion returns events after given version

```ts
describe("PrismaEventSourcedAggregatePersistence - PartialEventLoad", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  it("should load events after a given version", async () => {
    await infra.eventSourcedPersistence.save(
      "Account",
      "acc-1",
      [
        { name: "AccountCreated", payload: { owner: "Alice" } },
        { name: "DepositMade", payload: { amount: 100 } },
        { name: "DepositMade", payload: { amount: 200 } },
      ],
      0,
    );
    const events = await (
      infra.eventSourcedPersistence as any
    ).loadAfterVersion("Account", "acc-1", 1);
    expect(events).toHaveLength(2);
    expect(events[0]!.name).toBe("DepositMade");
    expect(events[0]!.payload).toEqual({ amount: 100 });
  });
});
```

### Event-sourced: loadAfterVersion returns empty for version beyond stream

```ts
it("should return empty array when afterVersion >= stream length", async () => {
  await infra.eventSourcedPersistence.save(
    "Account",
    "acc-1",
    [{ name: "AccountCreated", payload: { owner: "Alice" } }],
    0,
  );
  const events = await (infra.eventSourcedPersistence as any).loadAfterVersion(
    "Account",
    "acc-1",
    99,
  );
  expect(events).toEqual([]);
});
```

### Event-sourced: loadAfterVersion with version 0 returns all events

```ts
it("should return all events when afterVersion is 0", async () => {
  await infra.eventSourcedPersistence.save(
    "Account",
    "acc-1",
    [
      { name: "AccountCreated", payload: { owner: "Alice" } },
      { name: "DepositMade", payload: { amount: 50 } },
    ],
    0,
  );
  const events = await (infra.eventSourcedPersistence as any).loadAfterVersion(
    "Account",
    "acc-1",
    0,
  );
  expect(events).toHaveLength(2);
});
```

### Outbox store: save and load unpublished entries

```ts
describe("PrismaOutboxStore", () => {
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
  // Can't load published entries directly, but loading unpublished returns 0
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

---

## PrismaAdapter (Class-Based API)

> Class-based adapter that implements `PersistenceAdapter` for use with `wireDomain({ persistenceAdapter })`. Replaces the lower-level `createPrismaAdapter` builder with a simpler constructor.

### Type Contract

````ts
import type {
  PersistenceAdapter,
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  UnitOfWorkFactory,
  SnapshotStore,
  OutboxStore,
  AggregateLocker,
} from "@noddde/core";

/**
 * Prisma-backed persistence adapter.
 *
 * Uses built-in Prisma models (NodddeEvent, NodddeAggregateState, etc.)
 * for all stores. No configuration needed beyond the PrismaClient instance.
 *
 * @example
 * ```ts
 * import { PrismaAdapter } from "@noddde/prisma";
 *
 * const adapter = new PrismaAdapter(prisma);
 * const domain = await wireDomain(definition, { persistenceAdapter: adapter });
 * ```
 */
export class PrismaAdapter implements PersistenceAdapter {
  constructor(prisma: any);

  /** Always provided. */
  unitOfWorkFactory: UnitOfWorkFactory;
  /** Always provided. */
  eventSourcedPersistence: EventSourcedAggregatePersistence;
  /** Always provided. */
  stateStoredPersistence: StateStoredAggregatePersistence;
  /** Always provided. */
  sagaPersistence: SagaPersistence;
  /** Always provided. */
  snapshotStore: SnapshotStore;
  /** Always provided. */
  outboxStore: OutboxStore;
  /** Advisory locker. Available for PostgreSQL, MySQL, MariaDB. */
  aggregateLocker?: AggregateLocker;

  /**
   * Returns a StateStoredAggregatePersistence bound to a dedicated Prisma model.
   *
   * @param model - The Prisma model name (e.g., "order").
   * @param columns - Optional column mapping overrides.
   */
  stateStored(
    model: string,
    columns?: Partial<PrismaStateTableColumnMap>,
  ): StateStoredAggregatePersistence;

  /**
   * Calls `prisma.$disconnect()` to close the connection pool.
   */
  close(): Promise<void>;
}
````

### Behavioral Requirements (PrismaAdapter)

29. The constructor accepts a PrismaClient instance and creates all persistence stores using built-in Prisma models.
30. All persistence stores are created eagerly in the constructor.
31. All persistence instances share a single `PrismaTransactionStore`, ensuring UoW atomicity.
32. `aggregateLocker` is provided for databases that support advisory locks (PostgreSQL, MySQL, MariaDB). It is `undefined` for SQLite.
33. `stateStored(model, columns?)` returns a `StateStoredAggregatePersistence` bound to the given Prisma model. The returned persistence shares the same transaction store.
34. `close()` calls `prisma.$disconnect()` to clean up the connection pool.
35. `isPersistenceAdapter(new PrismaAdapter(prisma))` returns `true`.
36. The existing `createPrismaAdapter` function is marked `@deprecated` and delegates to `PrismaAdapter` internally.

### Deprecation

`createPrismaAdapter` is deprecated in favor of `PrismaAdapter`. It continues to work for backward compatibility.

```ts
/** @deprecated Use `new PrismaAdapter(prisma)` instead. */
export function createPrismaAdapter(
  prisma: any,
  config?: PrismaAdapterConfig,
): PrismaAdapterResult;
```

### Test Scenarios (PrismaAdapter)

### PrismaAdapter implements PersistenceAdapter

```ts
import { isPersistenceAdapter } from "@noddde/core";
import { PrismaAdapter } from "@noddde/prisma";

const adapter = new PrismaAdapter(prisma);
expect(isPersistenceAdapter(adapter)).toBe(true);
```

### PrismaAdapter provides all stores

```ts
const adapter = new PrismaAdapter(prisma);

expect(adapter.unitOfWorkFactory).toBeDefined();
expect(adapter.eventSourcedPersistence).toBeDefined();
expect(adapter.stateStoredPersistence).toBeDefined();
expect(adapter.sagaPersistence).toBeDefined();
expect(adapter.snapshotStore).toBeDefined();
expect(adapter.outboxStore).toBeDefined();
```

### PrismaAdapter.stateStored returns dedicated persistence

```ts
const adapter = new PrismaAdapter(prisma);
const dedicated = adapter.stateStored("order");

expect(dedicated).toBeDefined();
expect(dedicated.save).toBeTypeOf("function");
expect(dedicated.load).toBeTypeOf("function");
```

### PrismaAdapter close disconnects client

```ts
const disconnectSpy = vi
  .spyOn(prisma, "$disconnect")
  .mockResolvedValue(undefined);
const adapter = new PrismaAdapter(prisma);
await adapter.close();

expect(disconnectSpy).toHaveBeenCalledOnce();
```
