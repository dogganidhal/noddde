# @noddde/typeorm

TypeORM persistence adapter for noddde. Works with PostgreSQL, MySQL, MariaDB, MSSQL, and SQLite.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
yarn add @noddde/typeorm typeorm
# or
npm install @noddde/typeorm typeorm
```

## What's Inside

- **`TypeORMAdapter`** &mdash; Full persistence adapter for `wireDomain`: event-sourced aggregates, state-stored aggregates, sagas, snapshots, and outbox
- **`TypeORMAdvisoryLocker`** &mdash; Distributed pessimistic locking (auto-detected from DataSource)
- **Built-in entities** &mdash; `NodddeEventEntity`, `NodddeAggregateStateEntity`, `NodddeSagaStateEntity`, `NodddeSnapshotEntity`, `NodddeOutboxEntryEntity`, `NodddeEventIdempotencyEntity`
- **Individual persistence classes** for fine-grained control
- **`TypeORMUnitOfWork`** &mdash; ACID transaction context
- **`TypeORMEventIdempotencyStore`** &mdash; durable event-handler redelivery dedup, for `withIdempotency()`

## Usage

```typescript
import { DataSource } from "typeorm";
import {
  TypeORMAdapter,
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
} from "@noddde/typeorm";
import { wireDomain } from "@noddde/engine";

const dataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: [
    NodddeEventEntity,
    NodddeAggregateStateEntity,
    NodddeSagaStateEntity,
  ],
  synchronize: true,
});

await dataSource.initialize();

const adapter = new TypeORMAdapter(dataSource);

const domain = await wireDomain(definition, {
  persistenceAdapter: adapter,
});
```

### Dedicated State Entities

For state-stored aggregates with custom TypeORM entities:

```typescript
const adapter = new TypeORMAdapter(dataSource);

adapter.stateStored(OrderStateEntity, {
  aggregateId: "id",
  state: "data",
  version: "rev",
});
```

### Event Handler Idempotency

Kafka/RabbitMQ deliver events with at-least-once semantics, so event handlers can be invoked more than once for the same event. `TypeORMEventIdempotencyStore` is a durable, TypeORM-backed implementation of `EventIdempotencyStore` (`@noddde/core`) that pairs with `withIdempotency()` to detect and skip redelivered events, backed by a real table so dedup state survives restarts and is shared across process instances (unlike `InMemoryEventIdempotencyStore`).

```typescript
import { DataSource } from "typeorm";
import {
  TypeORMEventIdempotencyStore,
  NodddeEventIdempotencyEntity,
} from "@noddde/typeorm";
import { withIdempotency } from "@noddde/core";

const dataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: [
    // ...your other entities
    NodddeEventIdempotencyEntity,
  ],
  synchronize: true,
});

await dataSource.initialize();

const idempotencyStore = new TypeORMEventIdempotencyStore(
  dataSource,
  { current: null }, // or a shared TypeORMTransactionStore to enlist in the active UoW
);

const handleOrderPlaced = withIdempotency(async (event, infrastructure) => {
  // ... handle the event
}, idempotencyStore);
```

`NodddeEventIdempotencyEntity` must be added to the `DataSource`'s `entities` array, same as the other `Noddde*Entity` classes. An optional `ttlMs` constructor argument enables lazy TTL expiry on `hasProcessed`; `removeExpired(ttlMs)` can be called periodically (e.g. from a cron job) to sweep old rows regardless of that setting.

## Peer Dependencies

- `typeorm` >= 0.3.0

## Related Packages

| Package                                                            | Description                                 |
| :----------------------------------------------------------------- | :------------------------------------------ |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)       | Types, interfaces, and definition functions |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine)   | Runtime engine with domain orchestration    |
| [`@noddde/drizzle`](https://www.npmjs.com/package/@noddde/drizzle) | Drizzle ORM persistence adapter             |
| [`@noddde/prisma`](https://www.npmjs.com/package/@noddde/prisma)   | Prisma persistence adapter                  |

## License

MIT
