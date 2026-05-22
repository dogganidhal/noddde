# @noddde/testing-integration

**Internal** integration-testing toolkit for noddde adapters. Not published.

## What's in here

- `src/containers/*` — thin testcontainers wrappers (`startPostgres`, `startMysql`,
  `startMssql`, `startKafka`, `startNats`, `startRabbitMq`). Each returns the
  connection details plus a `stop()` cleanup function.
- `src/contracts/*` — shared contract test suites. An adapter's integration
  test imports e.g. `definePersistenceContract` and passes a factory that
  builds the adapter against a freshly provisioned backend; the contract
  registers a uniform set of `describe`/`it` blocks against it.
- `src/utils.ts` — `waitFor`, `sleep`, `uniqueSuffix` for test ergonomics.

## How adapters consume it

```ts
// packages/adapters/drizzle/src/__tests__/integration/postgres.integration.test.ts
import { startPostgres, definePersistenceContract } from "@noddde/testing-integration";

const pg = await startPostgres();
definePersistenceContract("drizzle/postgres", async () => {
  // build adapter against pg.url, truncate state…
  return { eventSourced, stateStored };
});
```

## Conventions

- Tests live in `<adapter>/src/__tests__/integration/<dialect>.integration.test.ts`.
- Each file owns a single container, started in `beforeAll`, stopped in `afterAll`.
- Tables are truncated between tests via the per-adapter `beforeEach`.
- Per-test factories return adapter instances configured against the shared
  container. They never start a container themselves — that would be far too
  slow.
- File names are the discriminator the CI matrix uses to shard work; do not
  rename them without updating `.github/workflows/integration.yml`.

## Running locally

```sh
# Requires Docker. Each adapter has its own script:
yarn workspace @noddde/drizzle  test:integration
yarn workspace @noddde/prisma   test:integration
yarn workspace @noddde/typeorm  test:integration
yarn workspace @noddde/kafka    test:integration
yarn workspace @noddde/nats     test:integration
yarn workspace @noddde/rabbitmq test:integration

# Or run everything via turbo:
yarn test:integration
```

## CI

`.github/workflows/integration.yml` uses `dorny/paths-filter` to detect which
adapters were affected by a PR. Each adapter has its own job; storage adapters
are further sharded by dialect via a matrix. A nightly cron and
`workflow_dispatch` always run every backend, guarding against cases where the
path filter under-selects.

## When to add a new test

| Want to … | Where to put the test |
|---|---|
| Strengthen behaviour every persistence adapter must obey | `contracts/persistence-contract.ts` (or the relevant contract file) |
| Cover a dialect-specific quirk (JSONB indexing, MySQL collation, …) | The matching `<adapter>/src/__tests__/integration/<dialect>.integration.test.ts` |
| Exercise a Kafka/NATS/RabbitMQ feature that has no cross-broker analogue | The broker's `*.integration.test.ts`, alongside the `defineEventBusContract` invocation |
