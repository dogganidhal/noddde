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

## Migrating: timestamp encoding change (breaking, since 1.0.0-rc.0)

As of `1.0.0-rc.0`, the pg/mysql schemas use `timestamp` columns in
`mode: "string"` and the persistence layer writes a portable, driver-agnostic
format: `YYYY-MM-DD HH:MM:SS.fff` (no `Z` suffix). Previously it used
`mode: "date"`. This changes the string the adapter sends to the database, not
the column type.

**Is my data at risk?** No, for ordering. `created_at` / `published_at` are
native `TIMESTAMPTZ` (pg) / `TIMESTAMP(3)` (mysql) columns. The database parses
both the old and new string encodings into real timestamp values, so
`ORDER BY created_at` (used by outbox reads) stays temporally correct even for
a table that mixes rows written before and after the upgrade. This is covered
by regression tests in
`src/__tests__/integration/{postgres,mysql}.integration.test.ts`.

**Migration runbook:**

1. No data migration is required — existing rows keep working and sort
   correctly alongside newly-written rows.
2. **Run your database in UTC** (or ensure the connection session time zone is
   UTC). The new format omits an explicit time zone, so on `TIMESTAMPTZ` a
   non-UTC session time zone would interpret written timestamps in that zone.
   Every noddde `Date` is serialized from `toISOString()` (UTC), so a UTC
   session keeps stored instants correct and consistent with any historical
   ISO-with-`Z` rows.
3. If you maintain your own migrations/DDL for the noddde tables, keep
   `created_at`/`published_at` as native timestamp columns (not `text`) so the
   database — not string comparison — determines ordering.

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
