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
