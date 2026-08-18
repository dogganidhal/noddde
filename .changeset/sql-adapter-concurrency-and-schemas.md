---
"@noddde/drizzle": minor
"@noddde/prisma": minor
"@noddde/typeorm": minor
---

Fix GA-readiness audit findings for the SQL adapters (#129, #130, #131), phase 1.

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
