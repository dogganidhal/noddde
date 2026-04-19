# @noddde/engine

Runtime engine for noddde: domain orchestration and in-memory implementations for DDD, CQRS, and Event Sourcing.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
yarn add @noddde/core @noddde/engine
# or
npm install @noddde/core @noddde/engine
```

## What's Inside

`@noddde/engine` provides:

- **Domain orchestration** (`defineDomain`, `wireDomain`) to compose aggregates, projections, and sagas into a running domain
- **In-memory implementations** for all infrastructure contracts: command bus, query bus, event bus, aggregate persistence, saga persistence, snapshot store, outbox store, unit of work, locking, and idempotency
- **Outbox relay** for reliable event publishing
- **Logger** with pluggable backends

The in-memory implementations are useful for development, testing, and prototyping. For production, swap them out with a persistence adapter (`@noddde/drizzle`, `@noddde/prisma`, or `@noddde/typeorm`).

## Usage

```typescript
import { defineDomain, wireDomain } from "@noddde/engine";
import { BankAccount } from "./aggregates/bank-account";
import { BalanceProjection } from "./projections/balance";

const definition = defineDomain({
  writeModel: {
    aggregates: { BankAccount },
  },
  readModel: {
    projections: { BalanceProjection },
  },
});

// Wire with in-memory backends (no adapter needed)
const domain = await wireDomain(definition);

// Dispatch commands
await domain.dispatchCommand({
  name: "Deposit",
  targetAggregateId: "acc-1",
  payload: { amount: 100 },
});
```

### With a Persistence Adapter

```typescript
import { DrizzleAdapter } from "@noddde/drizzle";

const adapter = new DrizzleAdapter(db);

const domain = await wireDomain(definition, {
  persistenceAdapter: adapter,
});
```

## Related Packages

| Package                                                            | Description                                                    |
| :----------------------------------------------------------------- | :------------------------------------------------------------- |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)       | Types, interfaces, and definition functions                    |
| [`@noddde/testing`](https://www.npmjs.com/package/@noddde/testing) | Test harnesses for aggregates, sagas, projections, and domains |
| [`@noddde/drizzle`](https://www.npmjs.com/package/@noddde/drizzle) | Drizzle ORM persistence adapter                                |
| [`@noddde/prisma`](https://www.npmjs.com/package/@noddde/prisma)   | Prisma persistence adapter                                     |
| [`@noddde/typeorm`](https://www.npmjs.com/package/@noddde/typeorm) | TypeORM persistence adapter                                    |

## License

MIT
