# @noddde/drizzle

## 1.0.0-rc.2

### Minor Changes

- ef341bb: Fix GA-readiness audit findings for the SQL adapters (#129, #130, #131), phase 1.

  **BLOCKER, all three adapters — cross-transaction contamination (#129).** The active DB
  transaction used to live in a single mutable field (`txStore.current = tx`) shared by every
  persistence instance, so a second `UnitOfWork.commit()` running concurrently could overwrite
  the first UoW's transaction mid-flight — including its rollback, silently discarding writes
  whose `commit()` had already resolved. `DrizzleTransactionStore`, `PrismaTransactionStore`,
  and `TypeORMTransactionStore` are now backed by `AsyncLocalStorage` instead. **Breaking**: any
  code constructing persistence classes directly with a raw `{ current: null }` object must
  switch to `{ als: new AsyncLocalStorage() }` — unaffected if you only use
  `DrizzleAdapter`/`PrismaAdapter`/`TypeORMAdapter` or the `create*Adapter` factories.

  **BLOCKER, TypeORM only — classic lost update (#129).** `TypeORMStateStoredAggregatePersistence`
  and the dedicated-table variant no longer `findOne()` + compare-in-app-code + unconditional
  `repo.save()`. They now issue a conditional `repo.update({..., version: expectedVersion}, ...)`
  and throw `ConcurrencyError` when zero rows are affected — the same shape Drizzle/Prisma
  already used. `ConcurrencyError.actualVersion` is now `-1` on TypeORM's version-mismatch path
  (parity with Drizzle/Prisma's existing sentinel), not the previously-read stored version.

  **MAJOR, Drizzle only — postgres-js rows-affected miss (#129).** The rows-affected probe now
  includes `result?.count` (the `drizzle-orm/postgres-js` shape), unified into one
  `getRowsAffected()` helper used by both the shared and dedicated state-stored persistence.

  **MAJOR, Drizzle and TypeORM — unique-violation detection by driver code (#129).** A new
  `isUniqueViolation(error)` helper (driver error codes first — PG `23505`, MySQL
  `ER_DUP_ENTRY`/`1062`, SQLite `SQLITE_CONSTRAINT*`, MSSQL `2627`/`2601` — message-regex only as
  a last resort) replaces ~15 duplicated, locale-fragile message-matching blocks.

  **BLOCKER, Drizzle only — missing PK/unique constraints on shipped schemas (#130).** The
  `aggregateStates`, `sagaStates`, and `snapshots` table definitions exported from
  `@noddde/drizzle/{pg,mysql,sqlite}` now declare the composite primary keys the integration-test
  DDL always required — tables provisioned from the shipped schema objects previously had no
  uniqueness at all, silently duplicating rows under concurrent writes.

  **BLOCKER, Drizzle only — double JSON encoding into jsonb/json columns (#130).** Drizzle
  persistence classes now pass raw objects to `jsonb`/`json` columns on PostgreSQL/MySQL instead
  of pre-stringifying (Drizzle's own column mapping already encodes once); SQLite `text` columns
  are unaffected. **Breaking, on-disk format**: existing double-encoded rows need the one-time
  backfill in `packages/adapters/drizzle/MIGRATIONS.md`.

  **MAJOR, Prisma only — MySQL `VARCHAR(191)` truncation (#130).** The base `schema.prisma` now
  carries a prominent comment directing MySQL deployments to `prisma/integration/mysql.prisma`
  (already `@db.LongText`-annotated) instead of copying the SQLite dev schema verbatim.

  **MAJOR, all three adapters — `EventReader` unimplemented (#131).** `Domain.rebuildProjection`
  threw `EventReaderUnavailableError` against every production database. All three adapters now
  expose `eventReader` (keyset-paginated over the existing global auto-increment `id` column);
  JSDoc documents the quiescence assumption (ids can commit out of order under concurrent
  writers, so a complete/gap-free read requires a quiescent log).

  **MAJOR, Drizzle and TypeORM — advisory-lock leaks on pooled connections (#131).** Advisory
  locks are session-scoped; acquiring on one pooled connection and releasing on another silently
  leaks the lock for the connection's lifetime. TypeORM now pins a dedicated `QueryRunner` per
  locker (safe even against a pooled `DataSource`) and keeps auto-wiring `aggregateLocker`. Drizzle
  has no equivalent pinning primitive on a generic `db` handle, so `DrizzleAdapter` no longer
  auto-wires a locker from a pooled `db`; use the new `DrizzleAdvisoryLocker.fromUrl(url, dialect)`
  (owns a single dedicated connection, mirroring `PrismaAdvisoryLocker.fromUrl`). All three
  adapters' lockers now also compose a per-process keyed mutex in front of the DB lock, closing
  the residual re-entrancy hole (a pinned session's advisory lock is otherwise re-entrant, so two
  concurrent commands in one process could both "acquire").

  **MAJOR→MINOR, all three adapters — unbounded outbox backlog scan (#131).** The outbox tables
  gain a nullable, indexed `eventId`/`event_id` column populated at `save()` time.
  `markPublishedByEventIds()` now issues a single indexed `UPDATE ... WHERE event_id IN (...)`
  instead of loading up to 10,000 unpublished rows into JS and filtering — cost no longer scales
  with backlog size, and entries past the old 10k cap are no longer silently un-matchable.
  Existing rows need the backfill in each package's `MIGRATIONS.md`.

  Phase 2 (SagaPersistence optimistic versioning, IdempotencyStore atomic claim, snapshot
  schema-version envelopes) is deferred until `core-api-freeze` lands.

### Patch Changes

- ec58bd0: Fix the CLI golden path and release-engineering hygiene ahead of GA (#136, #141):

  - **CLI scaffolds now install and compile.** `noddde new project` no longer pins `@noddde/*` deps at `^0.0.0` (which matched no published version) and no longer depends on the private, unpublished `@noddde/typescript-config` — the generated `tsconfig.json` inlines the base compiler options instead.
  - **Generated query handlers are payload-first**, matching `QueryHandler`'s actual signature (`query.id`, not `query.payload.id`) — fixes `noddde new projection`, `noddde new domain`, and `noddde add query`.
  - **Every event-bus choice compiles.** The Kafka/NATS/RabbitMQ `main.ts` scaffolds now wire the full `CQRSInfrastructure` triple instead of only `eventBus`; the NATS scaffold also supplies the required `consumerGroup`.
  - **`noddde new saga` compiles immediately** — it wires a concrete placeholder event instead of an empty `startedBy: []`, which violated `Saga.startedBy`'s non-empty-tuple type.
  - **Scaffolds use the non-deprecated `defineDomain` form**, exporting `definition` (not `<name>Domain`) plus `InferDomain`-based type — this also makes `noddde diagram`'s default entry path read what `new project`/`new domain` just generated.
  - **`noddde --version` reports the CLI's real version** instead of a hardcoded `0.0.0`.
  - Added a "compile the scaffold" test harness (`packages/cli/src/__tests__/scaffold-compile.test.ts`) that resolves every generator's output against the real, built `@noddde/*` packages and runs `tsc --noEmit` — closing the gap that let the above drift ship green under string-containment-only tests.
  - **Every published tarball now ships its LICENSE file** (verified via `npm pack --dry-run`).
  - **Internal `@noddde/*` dependencies use caret ranges** instead of exact pins, so npm/yarn can dedupe to a single `@noddde/core` install — an exact pin risked a duplicate copy silently breaking `ConcurrencyError`/`DeleteView` identity checks in `@noddde/engine`.
  - **Peer ranges are now honest about what's tested**: `drizzle-orm` (`>=0.30.0 <0.46.0`), `typeorm` (`>=0.3.0 <0.4.0`), and `amqplib` (`>=0.10.0 <0.11.0`) no longer claim compatibility with untested major/minor lines.
  - Added an `engines` field (`node >=22`, matching what CI actually builds against) to every published package.
  - `yarn release` now runs the test suite and re-syncs per-package LICENSE files before `changeset publish`.
  - `@noddde/prisma` no longer ships its integration-test-only Postgres/MySQL Prisma schemas in the published tarball.

- f0438a4: Fix `DrizzleSagaPersistence` to actually implement the `SagaPersistence` contract: `save()` was missing the `expectedVersion` parameter (silently ignored on every call) and `load()` returned the raw saga state instead of `{ state, version } | null`. The saga executor reads `loaded.state`, so every multi-step saga (any saga reacting to more than one event) silently lost its state after the first transition, then crashed on the next event with `TypeError: Cannot read properties of undefined`.

  `sagaStates` now has a `version` column (sqlite/pg/mysql) and `save()`/`load()` use the same optimistic-concurrency pattern as `DrizzleStateStoredAggregatePersistence` (insert when `expectedVersion === 0`, versioned `UPDATE ... WHERE version = expectedVersion` otherwise, `ConcurrencyError` on conflict). Existing `noddde_saga_states` tables need a manual `ALTER TABLE noddde_saga_states ADD COLUMN version INTEGER NOT NULL DEFAULT 0` migration.

- Updated dependencies [ec58bd0]
- Updated dependencies [525513c]
  - @noddde/core@1.0.0-rc.2

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
