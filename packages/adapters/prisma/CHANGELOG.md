# @noddde/prisma

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
