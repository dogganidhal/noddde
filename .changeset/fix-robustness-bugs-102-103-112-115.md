---
"@noddde/kafka": minor
"@noddde/prisma": minor
"@noddde/typeorm": minor
"@noddde/drizzle": minor
---

Fix adapter robustness bugs surfaced in `packages/testing-integration/ROBUSTNESS.md` (#102, #103, #112, #115):

- **Kafka (#115)** — `KafkaEventBus.on()` after `connect()` for a topic that isn't already subscribed now **throws** a clear error instead of firing a never-retried `consumer.subscribe()` and logging a misleading "will be retried" message (kafkajs cannot subscribe on a running consumer, so the subscription was silently lost). Register all handlers before `connect()`; `wireDomain()` already does this. Registering an additional handler for an already-subscribed topic is still allowed.

- **Prisma (#103)** — advisory locks are session-scoped, but Prisma multiplexes over its connection pool, so `acquire()` and `release()` could run on different sessions and leak the lock. New `PrismaAdvisoryLocker.fromUrl(url, dialect, options?)` owns a client pinned to `connection_limit=1` (guaranteeing session affinity) and implements `Closeable` (`close()` disconnects it; the engine auto-discovers it on shutdown). As a safety net, `release()` now throws an actionable error if it detects that a held lock was released on a different connection (PG `pg_advisory_unlock` → `false`, MySQL `RELEASE_LOCK` → `0`/`NULL`), while a double-release remains an idempotent no-op.

- **TypeORM (#102)** — on MSSQL, `text` columns map to the legacy codepage-limited `TEXT` type and silently corrupted supplementary-plane Unicode (emoji, etc.) in event payloads. New `createNodddeEntities(dialect)` returns entities whose JSON/text columns use `nvarchar(max)` on MSSQL (and the unchanged default classes elsewhere). The adapter resolves each store by table name, so it works with whichever entity variant you register. MSSQL users must register `createNodddeEntities("mssql")`.

- **Drizzle (#112)** — **BREAKING (already shipped in `1.0.0-rc.0`):** pg/mysql timestamp columns switched from `mode: "date"` to `mode: "string"`, emitting `YYYY-MM-DD HH:MM:SS.fff` (no `Z`). New regression tests confirm that because `created_at`/`published_at` are native `TIMESTAMPTZ`/`TIMESTAMP(3)` columns, the database parses both the old ISO-with-Z and new space-separated encodings to real timestamps, so `ORDER BY created_at` remains temporal for mixed-format (mid-migration) tables — no read-path normalization is required. See the migration runbook in `packages/adapters/drizzle/README.md`.
