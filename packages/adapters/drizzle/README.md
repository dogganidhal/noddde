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

## Upgrading

### Timestamp column format (pre-1.0 → 1.0.0-rc.0)

As of `1.0.0-rc.0`, `created_at`/`published_at` on PostgreSQL and MySQL are read/written as strings (Drizzle `mode: "string"`) instead of JS `Date` objects (`mode: "date"`). Written values now look like `2024-06-01 08:00:00.000` (space-separated, no `Z`) instead of the ISO-8601-with-`Z` form the pg driver's `Date` serialization used to produce.

**This is safe to deploy without a data migration.** `created_at`/`published_at` are native `TIMESTAMPTZ` (PostgreSQL) / `TIMESTAMP(3)` (MySQL) columns — the database parses any accepted textual form into the same internal temporal value before storing or comparing it, so:

- Existing rows written under the old format keep sorting correctly relative to new rows under `ORDER BY created_at` (verified by a regression test that inserts both formats and asserts temporal ordering — see `src/__tests__/integration/{postgres,mysql}.integration.test.ts`).
- On MySQL specifically, the old ISO-with-`Z` shape was never actually persisted as literal text either way — MySQL's `TIMESTAMP` parser rejects a trailing `Z` outright, so there is no on-disk representation to worry about.

No action is required beyond upgrading the package. SQLite is unaffected — it has always stored timestamps as `TEXT`.

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
