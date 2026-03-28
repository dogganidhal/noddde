# Flash Sale Sample

A reference project demonstrating production infrastructure patterns: optimistic and pessimistic concurrency strategies, snapshots, idempotency, and the outbox pattern — all under high contention.

**Stack**: TypeORM + PostgreSQL | `@noddde/typeorm`

## Quick Start

```bash
yarn install
npx vitest run                     # Run all tests (no Docker needed — tests use in-memory harnesses)
npx tsx src/main-optimistic.ts     # Optimistic concurrency demo (requires Docker for PostgreSQL)
npx tsx src/main-pessimistic.ts    # Pessimistic concurrency demo (requires Docker for PostgreSQL)
```

Both entry points use [Testcontainers](https://testcontainers.com/) to spin up a PostgreSQL instance automatically — Docker must be running.

## Domain Overview

A flash sale where limited stock sells first-come-first-served. Multiple buyers attempt to purchase the same item concurrently, creating high contention on a single aggregate.

```
(new) ──CreateFlashSale──> { stock: N, sold: 0 }
      ──PurchaseItem──> ItemPurchased (stock > 0)
                      | PurchaseRejected (stock = 0)
```

### FlashSaleItem Aggregate (Event-Sourced)

| Command          | Payload                  | Produces           | Guard        |
| ---------------- | ------------------------ | ------------------ | ------------ |
| `CreateFlashSale`| `initialStock`           | `FlashSaleCreated` | —            |
| `PurchaseItem`   | `buyerId, quantity`      | `ItemPurchased`    | stock > 0    |
|                  |                          | `PurchaseRejected` | stock = 0    |

**Key patterns:**
- **Rejection events** (`PurchaseRejected`) — records out-of-stock attempts as domain events, not exceptions
- **No-op apply** — `PurchaseRejected` leaves state unchanged

## Concurrency Strategies

### Optimistic (`main-optimistic.ts`)

The command handler is trivial (check stock, decrement, return event), so retries are cheap. If two buyers load the same version simultaneously, one succeeds and the other gets a `ConcurrencyError`. The framework automatically retries — re-loading the latest stock, re-running the check, and re-attempting the save.

```ts
const domain = await wireDomain(flashSaleDomain, {
  aggregates: {
    persistence: () => typeormInfra.eventSourcedPersistence,
    concurrency: { maxRetries: 5 },
  },
});
```

The demo fires 8 concurrent purchases against 5 items in stock, demonstrating that exactly 5 succeed and 3 are rejected — with no data corruption.

### Pessimistic (`main-pessimistic.ts`)

When command handlers involve expensive validation and wasted retries are costly, pessimistic locking serializes access. Uses `TypeORMAdvisoryLocker` with PostgreSQL's `pg_advisory_lock`:

```ts
import { TypeORMAdvisoryLocker } from "@noddde/typeorm";

const domain = await wireDomain(flashSaleDomain, {
  aggregates: {
    persistence: () => typeormInfra.eventSourcedPersistence,
    concurrency: {
      strategy: "pessimistic",
      locker: new TypeORMAdvisoryLocker(dataSource),
      lockTimeoutMs: 5000,
    },
  },
});
```

Each buyer acquires a lock, runs the handler against current state, and releases the lock. No wasted work — no retries.

## Persistence — TypeORM + PostgreSQL

This sample demonstrates the `@noddde/typeorm` adapter:

```ts
import { DataSource } from "typeorm";
import {
  createTypeORMPersistence,
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
  NodddeOutboxEntryEntity,
} from "@noddde/typeorm";

const dataSource = new DataSource({
  type: "postgres",
  url: connectionUri,
  entities: [NodddeEventEntity, NodddeAggregateStateEntity, NodddeSagaStateEntity, NodddeSnapshotEntity, NodddeOutboxEntryEntity],
  synchronize: true,
});
await dataSource.initialize();
const typeormInfra = createTypeORMPersistence(dataSource);
```

TypeORM's `synchronize: true` auto-creates all tables — no manual DDL needed.

## Framework Features Demonstrated

| Feature | Where |
| --- | --- |
| `defineAggregate` (event-sourced) | FlashSaleItem |
| Optimistic concurrency | `main-optimistic.ts` with `maxRetries: 5` |
| Pessimistic concurrency | `main-pessimistic.ts` with `TypeORMAdvisoryLocker` |
| Rejection events | PurchaseRejected (no-op apply) |
| TypeORM adapter | `createTypeORMPersistence` + PostgreSQL |
| CLI-conformant structure | event-model/, write-model/ |

## Tests

```
__tests__/
  unit/
    flash-sale-aggregate.test.ts         # testAggregate — command handler validation
    flash-sale-state.test.ts             # evolveAggregate + stripMetadata — state reconstruction
  slice/
    flash-sale-lifecycle.test.ts         # testDomain + stripMetadata — full lifecycle
    stock-depletion.test.ts              # testDomain — race to zero stock
    idempotency.test.ts                  # testDomain — commandId deduplication
  infrastructure/
    snapshot-restoration.test.ts         # evolveAggregate — snapshot equivalence verification
```

Tests use `@noddde/testing` harnesses which are adapter-agnostic — no Docker or database needed.

## Project Structure

```
src/
  main-optimistic.ts                     # Optimistic concurrency entry point
  main-pessimistic.ts                    # Pessimistic concurrency entry point
  infrastructure/
    index.ts                             # FlashSaleInfrastructure type
  domain/
    domain.ts                            # defineDomain — aggregates only
    event-model/
      index.ts                           # FlashSaleEvent union (DefineEvents)
      flash-sale-created.ts              # Individual event payload interfaces
      item-purchased.ts
      purchase-rejected.ts
    write-model/
      aggregates/
        flash-sale-item/
          flash-sale-item.ts             # defineAggregate (refs extracted handlers)
          state.ts                       # FlashSaleState + initialFlashSaleState
          commands/                      # One file per command payload
          command-handlers/              # One file per handler (standalone fn)
```
