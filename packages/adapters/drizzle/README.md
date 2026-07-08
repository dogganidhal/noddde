# @noddde/drizzle

Drizzle ORM persistence adapter for noddde. Supports PostgreSQL, MySQL, and SQLite.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
yarn add @noddde/drizzle drizzle-orm
# or
npm install @noddde/drizzle drizzle-orm
```

## What's Inside

- **`DrizzleAdapter`** &mdash; Full persistence adapter for `wireDomain`: event-sourced aggregates, state-stored aggregates, sagas, snapshots, and outbox
- **`DrizzleAdvisoryLocker`** &mdash; Distributed pessimistic locking (PostgreSQL/MySQL)
- **`DrizzleSnapshotStore`** / **`DrizzleOutboxStore`** &mdash; Optional stores
- **`DrizzleEventIdempotencyStore`** &mdash; Durable event-handler redelivery dedup, paired with `withIdempotency()`
- **Built-in schemas** via `@noddde/drizzle/pg`, `@noddde/drizzle/sqlite`, `@noddde/drizzle/mysql`

The dialect is auto-detected from your Drizzle `db` instance.

## Usage

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { DrizzleAdapter } from "@noddde/drizzle";
import { wireDomain } from "@noddde/engine";
import * as schema from "./schema";

const db = drizzle(connectionString, { schema });

const adapter = new DrizzleAdapter(db);

const domain = await wireDomain(definition, {
  persistenceAdapter: adapter,
});
```

### With Convenience Schemas

```typescript
// PostgreSQL
import { nodddeSchema } from "@noddde/drizzle/pg";
// SQLite
import { nodddeSchema } from "@noddde/drizzle/sqlite";
// MySQL
import { nodddeSchema } from "@noddde/drizzle/mysql";
```

### Dedicated State Tables

For state-stored aggregates with custom table shapes:

```typescript
const adapter = new DrizzleAdapter(db);

adapter.stateStored(usersTable, {
  aggregateId: "id",
  state: "data",
  version: "version",
});
```

### Event Handler Idempotency

`DrizzleEventIdempotencyStore` gives `withIdempotency()` (from `@noddde/core`) a durable, restart-safe backing store, so event handlers can detect and skip duplicate deliveries under Kafka/RabbitMQ at-least-once redelivery. Like `DrizzleOutboxStore`, it's dialect-agnostic: you supply the dialect-specific `eventIdempotency` table.

```typescript
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eventIdempotency } from "@noddde/drizzle/sqlite"; // or /pg, /mysql
import { DrizzleEventIdempotencyStore } from "@noddde/drizzle";
import { withIdempotency } from "@noddde/core";

const db = drizzle(new Database("app.db"));
const store = new DrizzleEventIdempotencyStore(
  db,
  { current: null },
  eventIdempotency,
);

const handler = withIdempotency(myEventHandler, store);
```

An optional `ttlMs` constructor argument applies lazy TTL expiry on `hasProcessed`. Call `store.removeExpired(ttlMs)` periodically (e.g. from a cron job) to sweep old rows and bound storage growth — it's never called automatically.

## Peer Dependencies

- `drizzle-orm` >= 0.30.0

## Related Packages

| Package                                                            | Description                                 |
| :----------------------------------------------------------------- | :------------------------------------------ |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)       | Types, interfaces, and definition functions |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine)   | Runtime engine with domain orchestration    |
| [`@noddde/prisma`](https://www.npmjs.com/package/@noddde/prisma)   | Prisma persistence adapter                  |
| [`@noddde/typeorm`](https://www.npmjs.com/package/@noddde/typeorm) | TypeORM persistence adapter                 |

## License

MIT
