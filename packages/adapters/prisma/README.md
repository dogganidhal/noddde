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
