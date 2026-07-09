# @noddde/prisma

## 1.0.0-rc.1

### Minor Changes

- 264f893: Fix adapter robustness bugs surfaced in `packages/testing-integration/ROBUSTNESS.md` (#102, #103, #112, #115):

  - **Kafka (#115)** — `KafkaEventBus.on()` after `connect()` for a topic that isn't already subscribed now **throws** a clear error instead of firing a never-retried `consumer.subscribe()` and logging a misleading "will be retried" message (kafkajs cannot subscribe on a running consumer, so the subscription was silently lost). Register all handlers before `connect()`; `wireDomain()` already does this. Registering an additional handler for an already-subscribed topic is still allowed.
  - **Prisma (#103)** — advisory locks are session-scoped, but Prisma multiplexes over its connection pool, so `acquire()` and `release()` could run on different sessions and leak the lock. New `PrismaAdvisoryLocker.fromUrl(url, dialect, options?)` owns a client pinned to `connection_limit=1` (guaranteeing session affinity) and implements `Closeable` (`close()` disconnects it; the engine auto-discovers it on shutdown). As a safety net, `release()` now throws an actionable error if it detects that a held lock was released on a different connection (PG `pg_advisory_unlock` → `false`, MySQL `RELEASE_LOCK` → `0`/`NULL`), while a double-release remains an idempotent no-op.
  - **TypeORM (#102)** — on MSSQL, `text` columns map to the legacy codepage-limited `TEXT` type and silently corrupted supplementary-plane Unicode (emoji, etc.) in event payloads. New `createNodddeEntities(dialect)` returns entities whose JSON/text columns use `nvarchar(max)` on MSSQL (and the unchanged default classes elsewhere). The adapter resolves each store by table name, so it works with whichever entity variant you register. MSSQL users must register `createNodddeEntities("mssql")`.
  - **Drizzle (#112)** — **BREAKING (already shipped in `1.0.0-rc.0`):** pg/mysql timestamp columns switched from `mode: "date"` to `mode: "string"`, emitting `YYYY-MM-DD HH:MM:SS.fff` (no `Z`). New regression tests confirm that because `created_at`/`published_at` are native `TIMESTAMPTZ`/`TIMESTAMP(3)` columns, the database parses both the old ISO-with-Z and new space-separated encodings to real timestamps, so `ORDER BY created_at` remains temporal for mixed-format (mid-migration) tables — no read-path normalization is required. See the migration runbook in `packages/adapters/drizzle/README.md`.

- 69b9817: Add `KafkaEventBus.warmup()` / `warmupOnConnect` for Kafka cold-start latency, and a new `EventIdempotencyStore` + `withIdempotency()` primitive (`@noddde/core`) for deduplicating event handler invocations under Kafka/RabbitMQ at-least-once redelivery, with an in-memory implementation in `@noddde/engine` and durable table-backed implementations in `@noddde/typeorm`, `@noddde/drizzle`, and `@noddde/prisma`.

  `@noddde/nats` gets a permanent benchmark test (no API change) documenting that per-subscription inbox-subject memory is negligible at scale — no code change was needed after measuring against a real broker.

### Patch Changes

- Updated dependencies [69b9817]
- Updated dependencies [54a763d]
  - @noddde/core@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- e03a054: First release candidate for v1.0.0.

  This kicks off the pre-release cycle ahead of the stable v1.0.0 release. The public API surface is now considered stable; subsequent `rc` builds will focus on stabilization, documentation, and adapter robustness based on community feedback.

  Highlights since 0.3.9:

  - **Adapters** — pg/mysql portability fixes across Drizzle/Prisma/TypeORM (timestamp encoding, advisory-lock return shapes, optimistic-concurrency detection on mysql2). NATS push consumers now declare an explicit `deliverTo` inbox (required by NATS Server >= 2.10). Kafka `connect()` waits for `GROUP_JOIN` so producers can't publish into the consumer's not-yet-joined window.
  - **Build output** — all packages now ship dual CJS and ESM bundles.
  - **Type system** — stress-tested across core and engine; results captured in `specs/reports/type-perf.md`.
  - **Docs** — full pre-GA audit pass across the documentation site (API drift, naming, broken links, structure).
  - **Integration testing** — adapter integration test suite with testcontainers + path-filtered CI lane.

### Patch Changes

- 830bcec: Fix dialect-portability and broker bugs in adapter persistence, locking, and event-bus subscriptions surfaced by the new integration test suite:

  - **Drizzle**: pg/mysql timestamp columns now use `mode: "string"` so the persistence layer can pass a portable string format (`YYYY-MM-DD HH:MM:SS.fff`, no `Z`); state-stored and saga `load()` defensively handle pre-parsed jsonb returns from pg; mysql advisory locker probes the multiple result shapes mysql2/drizzle expose and coerces the BIGINT `GET_LOCK` return value; state-stored `save()` now also reads `affectedRows` (mysql2 `ResultSetHeader`) when checking for the optimistic-concurrency conflict.
  - **Prisma**: pg advisory locker uses `$executeRawUnsafe` for the void-returning `pg_advisory_lock`; previously failed with a P2010 deserialize error.
  - **TypeORM**: `NodddeEventEntity.createdAt` / `NodddeOutboxEntryEntity.createdAt` no longer hardcode `type: "datetime"` (SQLite-only) — TypeORM now picks the dialect-native datetime; `NodddeOutboxEntryEntity.publishedAt` uses a text-backed value transformer to work around `Date | null` collapsing to `Object` in TS reflection; mysql advisory locker coerces the BIGINT GET_LOCK result with `Number()`.
  - **NATS**: JetStream push consumers now declare an explicit `deliverTo` inbox per subscription. NATS Server >= 2.10 rejects push consumer creation without one.
  - **Kafka**: `connect()` now waits for the `GROUP_JOIN` event (capped at 30s) before resolving so producers can't publish into a consumer's "not-yet-joined" window — the message would otherwise be lost because the default `fromBeginning: false` starts the offset at "latest" _after_ the publish.

- Updated dependencies [e03a054]
  - @noddde/core@1.0.0-rc.0

## 0.3.9

### Patch Changes

- 9a3e3b7: build: emit dual CJS + ESM for all packages via tsup
- Updated dependencies [9a3e3b7]
  - @noddde/core@0.3.9
