---
title: "PrismaEventIdempotencyStore"
module: prisma/prisma-event-idempotency-store
source_file: packages/adapters/prisma/src/event-idempotency.ts
status: implemented
exports: [PrismaEventIdempotencyStore]
depends_on: [edd/event-idempotency]
docs: [] # TODO: no docs page yet
---

# PrismaEventIdempotencyStore

> Durable, Prisma-backed implementation of `EventIdempotencyStore` (`@noddde/core`, see `core/edd/event-idempotency`). Backs `withIdempotency()` with a real table (`noddde_event_idempotency`) so dedup state survives restarts and is shared across process instances — unlike `InMemoryEventIdempotencyStore`. Requires the consuming application to add the `NodddeEventIdempotencyRecord` model to its own `schema.prisma` and run `prisma generate`, same as `PrismaOutboxStore`/`PrismaSnapshotStore`.

## Type Contract

```ts
import type { PrismaClient } from "@prisma/client";
import type { EventIdempotencyStore } from "@noddde/core";
import type { PrismaTransactionStore } from "./index";

/**
 * Prisma-backed EventIdempotencyStore. Enlists in the active
 * PrismaTransactionStore's transaction when one is present, same as
 * PrismaOutboxStore/PrismaSnapshotStore.
 */
export class PrismaEventIdempotencyStore implements EventIdempotencyStore {
  constructor(
    prisma: PrismaClient,
    txStore: PrismaTransactionStore,
    ttlMs?: number,
  );
  hasProcessed(key: string): Promise<boolean>;
  markProcessed(key: string): Promise<void>;
  removeExpired(ttlMs: number): Promise<void>;
}
```

Required Prisma model, added to `packages/adapters/prisma/prisma/schema.prisma` (this package's reference/test schema — the same model must be documented for consumers to add to their own schema, per the existing `PrismaOutboxStore` pattern):

```prisma
/// Event idempotency table for deduping event handler invocations under at-least-once redelivery.
model NodddeEventIdempotencyRecord {
  key         String   @id
  processedAt DateTime @map("processed_at")

  @@map("noddde_event_idempotency")
}
```

## Behavioral Requirements

1. **Model delegate** -- Uses the `nodddeEventIdempotencyRecord` Prisma delegate (from the `NodddeEventIdempotencyRecord` model above), accessed the same way `PrismaOutboxStore` accesses `nodddeOutboxEntry`: `(executor as any).nodddeEventIdempotencyRecord`.
2. **Executor resolution** -- Resolves the active executor via `this.txStore.current ?? this.prisma`, same as `PrismaOutboxStore`.
3. **markProcessed inserts and tolerates duplicates** -- `markProcessed(key)` calls `create({ data: { key, processedAt: new Date() } })`. If the create fails with Prisma error code `P2002` (unique constraint violation — the key was already marked processed), the error is caught and treated as success, matching the existing `P2002`-catching convention in `persistence.ts`.
4. **hasProcessed with optional TTL** -- `hasProcessed(key)` calls `findUnique({ where: { key } })`. Returns `false` if no record is found. If a record exists and constructor `ttlMs` is configured, checks `Date.now() - record.processedAt.getTime() > ttlMs`; if expired, deletes the record (`delete({ where: { key } })`) and returns `false`. Otherwise returns `true`.
5. **removeExpired sweeps old rows** -- `removeExpired(ttlMs)` calls `deleteMany({ where: { processedAt: { lte: new Date(Date.now() - ttlMs) } } })`. Independent of constructor `ttlMs`.

## Invariants

- `key` is the model's `@id`; at most one record exists per key at any time.
- After `markProcessed(key)` resolves, `hasProcessed(key)` resolves `true` (barring a `ttlMs` expiry race).
- Never relies on a native upsert — follows the established create-and-catch-`P2002` idiom used throughout `@noddde/prisma`.

## Edge Cases

- **markProcessed called twice for the same key**: Second call's `create` fails with `P2002`, caught and swallowed; no error propagates.
- **hasProcessed for a key that was never marked**: Returns `false`.
- **hasProcessed with expired record and ttlMs configured**: Deletes the record, returns `false`.
- **hasProcessed without ttlMs configured**: Records never expire from `hasProcessed`.
- **removeExpired(0)**: Removes all records.
- **markProcessed fails with a non-`P2002` error**: Propagates unchanged.
- **`NodddeEventIdempotencyRecord` model missing from the consumer's schema**: `prisma.nodddeEventIdempotencyRecord` is `undefined` at runtime; calling any method throws a `TypeError`. (Matches existing behavior for other optional Prisma stores — no bespoke validation is added here, consistent with `PrismaOutboxStore`/`PrismaSnapshotStore` which also don't self-validate; only the aggregate-state-table path in `builder.ts` does that check today.)

## Integration Points

- Implements `EventIdempotencyStore` from `@noddde/core`.
- Constructed directly by the application: `new PrismaEventIdempotencyStore(prisma, txStore)` — not currently wired into `createPrismaAdapter()`'s config-gated result (unlike `snapshotStore`/`outboxStore`); can be added there in a follow-up if demand emerges.
- Pair with `withIdempotency(handler, store)` from `@noddde/core` to dedupe event handler invocations under Kafka/RabbitMQ at-least-once redelivery.
- Requires the consumer to add `NodddeEventIdempotencyRecord` to their `schema.prisma` and run `prisma generate` — document this in the `@noddde/prisma` README next to the existing outbox/snapshot model requirements.

## Test Scenarios

### markProcessed then hasProcessed round-trip

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaEventIdempotencyStore } from "@noddde/prisma";

describe("PrismaEventIdempotencyStore", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await (prisma as any).nodddeEventIdempotencyRecord.deleteMany();
  });

  it("should return true for hasProcessed after markProcessed", async () => {
    const store = new PrismaEventIdempotencyStore(prisma, { current: null });

    await store.markProcessed("evt-1");

    expect(await store.hasProcessed("evt-1")).toBe(true);
  });

  it("should return false for a key that was never marked processed", async () => {
    const store = new PrismaEventIdempotencyStore(prisma, { current: null });

    expect(await store.hasProcessed("never-seen")).toBe(false);
  });

  it("should not throw when markProcessed is called twice for the same key", async () => {
    const store = new PrismaEventIdempotencyStore(prisma, { current: null });

    await store.markProcessed("evt-dup");
    await expect(store.markProcessed("evt-dup")).resolves.toBeUndefined();
    expect(await store.hasProcessed("evt-dup")).toBe(true);
  });

  it("should remove expired records via removeExpired while keeping recent ones", async () => {
    const store = new PrismaEventIdempotencyStore(prisma, { current: null });

    await store.markProcessed("evt-old");
    await (prisma as any).nodddeEventIdempotencyRecord.update({
      where: { key: "evt-old" },
      data: { processedAt: new Date(Date.now() - 10_000) },
    });
    await store.markProcessed("evt-recent");

    await store.removeExpired(5_000);

    expect(await store.hasProcessed("evt-old")).toBe(false);
    expect(await store.hasProcessed("evt-recent")).toBe(true);
  });

  it("should apply lazy TTL cleanup on hasProcessed when constructed with ttlMs", async () => {
    const store = new PrismaEventIdempotencyStore(
      prisma,
      { current: null },
      100,
    );

    await store.markProcessed("evt-ttl");
    await (prisma as any).nodddeEventIdempotencyRecord.update({
      where: { key: "evt-ttl" },
      data: { processedAt: new Date(Date.now() - 200) },
    });

    expect(await store.hasProcessed("evt-ttl")).toBe(false);
  });
});
```
