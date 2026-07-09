---
title: "TypeORMEventIdempotencyStore"
module: typeorm/typeorm-event-idempotency-store
source_file: packages/adapters/typeorm/src/event-idempotency.ts
status: implemented
exports: [TypeORMEventIdempotencyStore, NodddeEventIdempotencyEntity]
depends_on: [edd/event-idempotency]
docs:
  - events/event-handlers.mdx
---

# TypeORMEventIdempotencyStore

> Durable, TypeORM-backed implementation of `EventIdempotencyStore` (`@noddde/core`, see `core/edd/event-idempotency`). Backs `withIdempotency()` with a real table (`noddde_event_idempotency`) so dedup state survives restarts and is shared across process instances — unlike `InMemoryEventIdempotencyStore`. Follows the same constructor/UoW-enlistment pattern as `TypeORMOutboxStore` and `TypeORMSnapshotStore`.

## Type Contract

```ts
import { Entity, PrimaryColumn, Column } from "typeorm";
import type { DataSource, EntityManager } from "typeorm";
import type { EventIdempotencyStore } from "@noddde/core";
import type { TypeORMTransactionStore } from "./unit-of-work";

/** TypeORM entity for the event idempotency dedup table. */
@Entity("noddde_event_idempotency")
export class NodddeEventIdempotencyEntity {
  @PrimaryColumn()
  key!: string;

  // No explicit `type` — TypeORM picks the dialect-native datetime.
  @Column({ name: "processed_at" })
  processedAt!: Date;
}

/**
 * TypeORM-backed EventIdempotencyStore. Enlists in the active
 * TypeORMTransactionStore's transaction when one is present, same as
 * TypeORMOutboxStore/TypeORMSnapshotStore.
 */
export class TypeORMEventIdempotencyStore implements EventIdempotencyStore {
  constructor(
    dataSource: DataSource,
    txStore: TypeORMTransactionStore,
    ttlMs?: number,
  );
  hasProcessed(key: string): Promise<boolean>;
  markProcessed(key: string): Promise<void>;
  removeExpired(ttlMs: number): Promise<void>;
}
```

## Behavioral Requirements

1. **Table** -- Backed by `NodddeEventIdempotencyEntity` mapped to table `noddde_event_idempotency`, with `key` (string primary key) and `processed_at` (dialect-native datetime column, mirroring `NodddeEventEntity.createdAt`'s "no explicit type" convention).
2. **Executor resolution** -- Like `TypeORMOutboxStore`, resolves the active `EntityManager` via `this.txStore.current ?? this.dataSource.manager`, so operations enlist in the current Unit of Work when one is active.
3. **markProcessed inserts and tolerates duplicates** -- `markProcessed(key)` inserts a row `{ key, processedAt: new Date() }`. If the insert fails due to a primary-key/unique violation (the key was already marked processed, e.g. by a concurrent redelivery), the error is caught and treated as success — matching `withIdempotency`'s "idempotent" contract. Violation detection follows the codebase's existing dialect-agnostic string-match convention (`/UNIQUE|duplicate|unique/i.test(message)`), same regex used in `TypeORMEventSourcedAggregatePersistence.save`.
4. **hasProcessed with optional TTL** -- `hasProcessed(key)` looks up the row by `key`. Returns `false` if no row exists. If a row exists and the constructor `ttlMs` is configured, checks `Date.now() - row.processedAt.getTime() > ttlMs`; if expired, deletes the row and returns `false` (lazy cleanup, mirroring `InMemoryEventIdempotencyStore`). If a row exists and is not expired (or no `ttlMs` configured), returns `true`.
5. **removeExpired sweeps old rows** -- `removeExpired(ttlMs)` deletes all rows where `processed_at <= Date.now() - ttlMs`. Independent of the constructor `ttlMs`. Intended for periodic maintenance (cron/background process) since `withIdempotency` never calls it automatically.

## Invariants

- `key` is the primary key; at most one row exists per key at any time.
- After `markProcessed(key)` resolves, `hasProcessed(key)` resolves `true` (barring a `ttlMs` expiry race, which is inherent to any TTL-based check).
- Never uses dialect-native `ON CONFLICT`/`MERGE` — follows the established insert-and-catch-unique-violation idiom used throughout `@noddde/typeorm`.

## Edge Cases

- **markProcessed called twice for the same key**: Second call's insert fails with a unique violation, which is caught and swallowed; no error propagates.
- **hasProcessed for a key that was never marked**: Returns `false`.
- **hasProcessed with expired row and ttlMs configured**: Deletes the row, returns `false`; a subsequent `hasProcessed` call also returns `false` (row is gone).
- **hasProcessed without ttlMs configured**: Rows never expire from `hasProcessed`, regardless of age.
- **removeExpired(0)**: Removes all rows (every row is at least 0ms old).
- **markProcessed fails with a non-unique-violation error** (e.g. connection drop): The error propagates unchanged — only unique-violation errors are swallowed.

## Integration Points

- Implements `EventIdempotencyStore` from `@noddde/core`.
- Constructed directly by the application: `new TypeORMEventIdempotencyStore(dataSource, txStore)` — not currently wired into `createTypeORMAdapter()`'s config-gated result (unlike `snapshotStore`/`outboxStore`); can be added there in a follow-up if demand emerges.
- Pair with `withIdempotency(handler, store)` from `@noddde/core` to dedupe event handler invocations under Kafka/RabbitMQ at-least-once redelivery.
- `NodddeEventIdempotencyEntity` must be included in the `TypeORM` `DataSource`'s `entities` array, same as the other `Nodded*Entity` classes.

## Test Scenarios

### markProcessed then hasProcessed round-trip

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DataSource } from "typeorm";
import {
  TypeORMEventIdempotencyStore,
  NodddeEventIdempotencyEntity,
} from "@noddde/typeorm";

describe("TypeORMEventIdempotencyStore", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: "sqlite",
      database: ":memory:",
      entities: [NodddeEventIdempotencyEntity],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it("should return true for hasProcessed after markProcessed", async () => {
    const store = new TypeORMEventIdempotencyStore(dataSource, {
      current: null,
    });

    await store.markProcessed("evt-1");

    expect(await store.hasProcessed("evt-1")).toBe(true);
  });

  it("should return false for a key that was never marked processed", async () => {
    const store = new TypeORMEventIdempotencyStore(dataSource, {
      current: null,
    });

    expect(await store.hasProcessed("never-seen")).toBe(false);
  });

  it("should not throw when markProcessed is called twice for the same key", async () => {
    const store = new TypeORMEventIdempotencyStore(dataSource, {
      current: null,
    });

    await store.markProcessed("evt-dup");
    await expect(store.markProcessed("evt-dup")).resolves.toBeUndefined();
    expect(await store.hasProcessed("evt-dup")).toBe(true);
  });

  it("should remove expired records via removeExpired while keeping recent ones", async () => {
    const store = new TypeORMEventIdempotencyStore(dataSource, {
      current: null,
    });

    await store.markProcessed("evt-old");
    // Force an old processedAt directly via the repository to simulate age.
    const repo = dataSource.getRepository(NodddeEventIdempotencyEntity);
    await repo.update(
      { key: "evt-old" },
      { processedAt: new Date(Date.now() - 10_000) },
    );
    await store.markProcessed("evt-recent");

    await store.removeExpired(5_000);

    expect(await store.hasProcessed("evt-old")).toBe(false);
    expect(await store.hasProcessed("evt-recent")).toBe(true);
  });

  it("should apply lazy TTL cleanup on hasProcessed when constructed with ttlMs", async () => {
    const store = new TypeORMEventIdempotencyStore(
      dataSource,
      { current: null },
      100,
    );

    await store.markProcessed("evt-ttl");
    const repo = dataSource.getRepository(NodddeEventIdempotencyEntity);
    await repo.update(
      { key: "evt-ttl" },
      { processedAt: new Date(Date.now() - 200) },
    );

    expect(await store.hasProcessed("evt-ttl")).toBe(false);
  });
});
```
