---
title: "DrizzleEventIdempotencyStore"
module: drizzle/drizzle-event-idempotency-store
source_file: packages/adapters/drizzle/src/event-idempotency.ts
status: implemented
exports: [DrizzleEventIdempotencyStore]
depends_on: [edd/event-idempotency]
docs:
  - events/event-handlers.mdx
---

# DrizzleEventIdempotencyStore

> Durable, Drizzle-backed implementation of `EventIdempotencyStore` (`@noddde/core`, see `core/edd/event-idempotency`). Backs `withIdempotency()` with a real table (`noddde_event_idempotency`) so dedup state survives restarts and is shared across process instances — unlike `InMemoryEventIdempotencyStore`. Dialect-agnostic, like `DrizzleOutboxStore`: the caller supplies the dialect-specific table definition.

## Type Contract

```ts
import type { EventIdempotencyStore } from "@noddde/core";
import type { DrizzleTransactionStore } from "./index";

/**
 * Drizzle-backed EventIdempotencyStore. Enlists in the active
 * DrizzleTransactionStore's transaction when one is present, same as
 * DrizzleOutboxStore/DrizzleSnapshotStore.
 *
 * `table` is the dialect-specific Drizzle table definition for the
 * `noddde_event_idempotency` table — import `eventIdempotency` from
 * `@noddde/drizzle/pg`, `@noddde/drizzle/mysql`, or `@noddde/drizzle/sqlite`,
 * or supply your own table matching the same column shape (`key`, `processedAt`).
 */
export class DrizzleEventIdempotencyStore implements EventIdempotencyStore {
  constructor(
    db: any,
    txStore: DrizzleTransactionStore,
    table: any,
    ttlMs?: number,
  );
  hasProcessed(key: string): Promise<boolean>;
  markProcessed(key: string): Promise<void>;
  removeExpired(ttlMs: number): Promise<void>;
}
```

Per-dialect table definitions (added to the existing `pg/schema.ts`, `mysql/schema.ts`, `sqlite/schema.ts` files, following the exact column-type conventions already used by `outbox` in each file):

```ts
// pg/schema.ts — postgres: text key, timestamp with timezone (mode: "string")
export const eventIdempotency = pgTable("noddde_event_idempotency", {
  key: text("key").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

// mysql/schema.ts — varchar(255) key, timestamp(3) (mode: "string")
export const eventIdempotency = mysqlTable("noddde_event_idempotency", {
  key: varchar("key", { length: 255 }).primaryKey(),
  processedAt: timestamp("processed_at", { mode: "string", fsp: 3 })
    .notNull()
    .defaultNow(),
});

// sqlite/schema.ts — text key, text processedAt (ISO-ish string, like other sqlite tables)
export const eventIdempotency = sqliteTable("noddde_event_idempotency", {
  key: text("key").primaryKey(),
  processedAt: text("processed_at").notNull(),
});
```

## Behavioral Requirements

1. **Table shape** -- `key` (text/varchar primary key) and `processedAt` (dialect-native timestamp column, following the `outbox` table's per-dialect conventions in each schema file).
2. **Executor resolution** -- Resolves the active executor via `this.txStore.current ?? this.db`, same as `DrizzleOutboxStore`.
3. **markProcessed inserts and tolerates duplicates** -- `markProcessed(key)` inserts `{ key, processedAt: toDbTimestamp(new Date()) }` into `table`. If the insert fails due to a primary-key violation (key already recorded), the error is caught using the codebase's existing cross-dialect string-match convention (`"UNIQUE constraint failed"` / `"unique constraint"` / `"Duplicate entry"` / `"duplicate key"` — same checks as `persistence.ts`) and treated as success.
4. **hasProcessed with optional TTL** -- `hasProcessed(key)` selects the row by `key`. Returns `false` if none exists. If a row exists and constructor `ttlMs` is configured, computes `Date.now() - new Date(row.processedAt).getTime()`; if greater than `ttlMs`, deletes the row and returns `false`. Otherwise returns `true`.
5. **removeExpired sweeps old rows** -- `removeExpired(ttlMs)` deletes all rows where `processedAt <= toDbTimestamp(new Date(Date.now() - ttlMs))`. Independent of constructor `ttlMs`.
6. **Timestamp normalization** -- All writes go through a `toDbTimestamp(d: Date): string` helper local to this file (same normalization logic as `persistence.ts`'s private helper: `d.toISOString().replace("T", " ").replace("Z", "")`), ensuring consistent string comparison across dialects.

## Invariants

- `key` is the primary key; at most one row exists per key at any time.
- After `markProcessed(key)` resolves, `hasProcessed(key)` resolves `true` (barring a `ttlMs` expiry race).
- Never uses dialect-native `ON CONFLICT`/upsert — follows the established insert-and-catch-unique-violation idiom used throughout `@noddde/drizzle`.

## Edge Cases

- **markProcessed called twice for the same key**: Second call's insert fails with a unique violation, caught and swallowed; no error propagates.
- **hasProcessed for a key that was never marked**: Returns `false`.
- **hasProcessed with expired row and ttlMs configured**: Deletes the row, returns `false`.
- **hasProcessed without ttlMs configured**: Rows never expire from `hasProcessed`.
- **removeExpired(0)**: Removes all rows.
- **markProcessed fails with a non-unique-violation error**: Propagates unchanged.

## Integration Points

- Implements `EventIdempotencyStore` from `@noddde/core`.
- Constructed directly by the application: `new DrizzleEventIdempotencyStore(db, txStore, eventIdempotency)` — not currently wired into `createDrizzleAdapter()`'s config-gated result (unlike `snapshotStore`/`outboxStore`); can be added there in a follow-up if demand emerges.
- Pair with `withIdempotency(handler, store)` from `@noddde/core` to dedupe event handler invocations under Kafka/RabbitMQ at-least-once redelivery.
- Per-dialect `eventIdempotency` table exported from `@noddde/drizzle/pg`, `@noddde/drizzle/mysql`, `@noddde/drizzle/sqlite` subpaths, same discovery pattern as `outbox`.

## Test Scenarios

### markProcessed then hasProcessed round-trip (sqlite)

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { eventIdempotency } from "@noddde/drizzle/sqlite";
import { DrizzleEventIdempotencyStore } from "@noddde/drizzle";

describe("DrizzleEventIdempotencyStore (sqlite)", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    db = drizzle(sqlite);
    db.run(sql`
      CREATE TABLE noddde_event_idempotency (
        key TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      )
    `);
  });

  it("should return true for hasProcessed after markProcessed", async () => {
    const store = new DrizzleEventIdempotencyStore(
      db,
      { current: null },
      eventIdempotency,
    );

    await store.markProcessed("evt-1");

    expect(await store.hasProcessed("evt-1")).toBe(true);
  });

  it("should return false for a key that was never marked processed", async () => {
    const store = new DrizzleEventIdempotencyStore(
      db,
      { current: null },
      eventIdempotency,
    );

    expect(await store.hasProcessed("never-seen")).toBe(false);
  });

  it("should not throw when markProcessed is called twice for the same key", async () => {
    const store = new DrizzleEventIdempotencyStore(
      db,
      { current: null },
      eventIdempotency,
    );

    await store.markProcessed("evt-dup");
    await expect(store.markProcessed("evt-dup")).resolves.toBeUndefined();
    expect(await store.hasProcessed("evt-dup")).toBe(true);
  });

  it("should remove expired records via removeExpired while keeping recent ones", async () => {
    const store = new DrizzleEventIdempotencyStore(
      db,
      { current: null },
      eventIdempotency,
    );

    await store.markProcessed("evt-old");
    db.run(
      sql`UPDATE noddde_event_idempotency SET processed_at = ${new Date(Date.now() - 10_000).toISOString().replace("T", " ").replace("Z", "")} WHERE key = 'evt-old'`,
    );
    await store.markProcessed("evt-recent");

    await store.removeExpired(5_000);

    expect(await store.hasProcessed("evt-old")).toBe(false);
    expect(await store.hasProcessed("evt-recent")).toBe(true);
  });

  it("should apply lazy TTL cleanup on hasProcessed when constructed with ttlMs", async () => {
    const store = new DrizzleEventIdempotencyStore(
      db,
      { current: null },
      eventIdempotency,
      100,
    );

    await store.markProcessed("evt-ttl");
    db.run(
      sql`UPDATE noddde_event_idempotency SET processed_at = ${new Date(Date.now() - 200).toISOString().replace("T", " ").replace("Z", "")} WHERE key = 'evt-ttl'`,
    );

    expect(await store.hasProcessed("evt-ttl")).toBe(false);
  });
});
```
