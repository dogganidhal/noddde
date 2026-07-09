# @noddde/prisma

Prisma persistence adapter for noddde. Works with any Prisma-supported database.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
yarn add @noddde/prisma @prisma/client
# or
npm install @noddde/prisma @prisma/client
```

## What's Inside

- **`PrismaAdapter`** &mdash; Full persistence adapter for `wireDomain`: event-sourced aggregates, state-stored aggregates, sagas, snapshots, and outbox
- **`PrismaAdvisoryLocker`** &mdash; Distributed pessimistic locking (PostgreSQL/MySQL)
- **Individual persistence classes** if you need fine-grained control: `PrismaEventSourcedAggregatePersistence`, `PrismaStateStoredAggregatePersistence`, `PrismaSagaPersistence`, `PrismaSnapshotStore`, `PrismaOutboxStore`
- **`PrismaEventIdempotencyStore`** &mdash; Durable dedup store for event handler redelivery (pairs with `withIdempotency()`)
- **`PrismaUnitOfWork`** &mdash; ACID transaction context

## Usage

```typescript
import { PrismaClient } from "@prisma/client";
import { PrismaAdapter } from "@noddde/prisma";
import { wireDomain } from "@noddde/engine";

const prisma = new PrismaClient();

const adapter = new PrismaAdapter(prisma, { dialect: "pg" });

const domain = await wireDomain(definition, {
  persistenceAdapter: adapter,
});
```

### Advisory locking & connection pooling (important)

Database advisory locks (PostgreSQL `pg_advisory_lock`, MySQL/MariaDB
`GET_LOCK`) are **session-scoped**: a lock must be released on the same DB
session it was acquired on. Prisma multiplexes queries across an internal
connection pool, so a locker built from an ordinary `PrismaClient` can acquire
on one connection and release on another — the release becomes a silent no-op
and the lock leaks.

Use `PrismaAdvisoryLocker.fromUrl(...)`, which owns a client pinned to
`connection_limit=1` and guarantees session affinity:

```typescript
import { PrismaAdvisoryLocker } from "@noddde/prisma";
import { wireDomain } from "@noddde/engine";

const locker = PrismaAdvisoryLocker.fromUrl(
  process.env.DATABASE_URL!,
  "postgresql", // or "mysql" | "mariadb"
);

const domain = await wireDomain(definition, {
  aggregates: {
    concurrency: { strategy: "pessimistic", locker, lockTimeoutMs: 5000 },
  },
});

// The engine auto-discovers the locker via Closeable and disconnects its
// owned client on shutdown. If you manage lifecycle manually:
await locker.close();
```

If you must pass your own `PrismaClient` to the constructor, it **must** be
pinned to a single connection (`?connection_limit=1` in the datasource URL).
As a safety net, `release()` throws with an actionable message if it detects a
lock that was released on a different connection than it was acquired on.

### Dedicated State Models

For state-stored aggregates with custom Prisma models:

```typescript
const adapter = new PrismaAdapter(prisma);

adapter.stateStored("order", {
  aggregateId: "id",
  state: "data",
  version: "rev",
});
```

### Event Handler Idempotency

`PrismaEventIdempotencyStore` is a durable, Prisma-backed implementation of `EventIdempotencyStore` (`@noddde/core`). Pair it with `withIdempotency()` to dedupe event handler invocations under Kafka/RabbitMQ at-least-once redelivery — dedup state survives restarts and is shared across process instances, unlike the in-memory store.

```typescript
import { PrismaClient } from "@prisma/client";
import { PrismaEventIdempotencyStore } from "@noddde/prisma";
import { withIdempotency } from "@noddde/core";

const prisma = new PrismaClient();
const idempotencyStore = new PrismaEventIdempotencyStore(prisma, {
  current: null,
});

const safeHandler = withIdempotency(myEventHandler, idempotencyStore);
```

Optionally pass a `ttlMs` third argument to lazily expire records read via `hasProcessed`, and call `removeExpired(ttlMs)` periodically (e.g. from a cron job) to bound table growth.

Like the outbox and snapshot stores, this requires the consuming application to add the `NodddeEventIdempotencyRecord` model to its own `schema.prisma` and run `prisma generate`:

```prisma
model NodddeEventIdempotencyRecord {
  key         String   @id
  processedAt DateTime @map("processed_at")

  @@map("noddde_event_idempotency")
}
```

## Peer Dependencies

- `@prisma/client` >= 5.0.0

## Related Packages

| Package                                                            | Description                                 |
| :----------------------------------------------------------------- | :------------------------------------------ |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)       | Types, interfaces, and definition functions |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine)   | Runtime engine with domain orchestration    |
| [`@noddde/drizzle`](https://www.npmjs.com/package/@noddde/drizzle) | Drizzle ORM persistence adapter             |
| [`@noddde/typeorm`](https://www.npmjs.com/package/@noddde/typeorm) | TypeORM persistence adapter                 |

## License

MIT
