# Migrations

One-time data migrations for existing databases upgrading past the GA
hardening fixes (issues #129, #130, #131). The framework ships schema
_definitions_, not a migration runner — apply the SQL below with whatever
migration tool your app already uses (drizzle-kit, a raw migration file,
etc.) before deploying the new adapter code.

## 1. Composite PK / unique constraint on `aggregate_states`, `saga_states`, `snapshots`

Older deployments provisioned from the shipped Drizzle schema objects had no
constraint on these tables. Deduplicate first (keep one row per key, e.g. the
most recently written), then add the constraint:

```sql
-- Postgres / MySQL
ALTER TABLE noddde_aggregate_states ADD PRIMARY KEY (aggregate_name, aggregate_id);
ALTER TABLE noddde_saga_states ADD PRIMARY KEY (saga_name, saga_id);
ALTER TABLE noddde_snapshots ADD PRIMARY KEY (aggregate_name, aggregate_id);
```

SQLite has no `ADD PRIMARY KEY` — recreate the table with the constraint and
copy the (deduplicated) rows over.

## 2. Un-double-encode `jsonb`/`json` columns (PostgreSQL, MySQL only)

Older Drizzle writes pre-stringified payload/metadata/state into `jsonb`/`json`
columns, so the stored value is a JSON _string scalar_, not an object.

```sql
-- Postgres: noddde_events.payload / .metadata, noddde_aggregate_states.state, noddde_snapshots.state
UPDATE noddde_events SET payload = (payload #>> '{}')::jsonb WHERE jsonb_typeof(payload) = 'string';
UPDATE noddde_events SET metadata = (metadata #>> '{}')::jsonb WHERE jsonb_typeof(metadata) = 'string';
UPDATE noddde_aggregate_states SET state = (state #>> '{}')::jsonb WHERE jsonb_typeof(state) = 'string';
UPDATE noddde_snapshots SET state = (state #>> '{}')::jsonb WHERE jsonb_typeof(state) = 'string';
UPDATE noddde_outbox SET event = (event #>> '{}')::jsonb WHERE jsonb_typeof(event) = 'string';
```

```sql
-- MySQL: noddde_events.payload / .metadata, noddde_outbox.event (these are the only `json`-typed columns on MySQL)
UPDATE noddde_events SET payload = CAST(JSON_UNQUOTE(payload) AS JSON) WHERE JSON_TYPE(payload) = 'STRING';
UPDATE noddde_events SET metadata = CAST(JSON_UNQUOTE(metadata) AS JSON) WHERE JSON_TYPE(metadata) = 'STRING';
UPDATE noddde_outbox SET event = CAST(JSON_UNQUOTE(event) AS JSON) WHERE JSON_TYPE(event) = 'STRING';
```

`noddde_aggregate_states`/`noddde_saga_states`/`noddde_snapshots.state` on
MySQL are plain `TEXT`, not `JSON` — no double-encoding bug there, no
migration needed. SQLite is `TEXT` everywhere — same, no migration needed.

## 3. Backfill `noddde_outbox.event_id`

The new indexed `event_id` column is populated automatically for new writes.
Existing rows have it `NULL` until backfilled:

```sql
-- Postgres
UPDATE noddde_outbox SET event_id = event->'metadata'->>'eventId'
WHERE event_id IS NULL AND event->'metadata'->>'eventId' IS NOT NULL;

-- MySQL
UPDATE noddde_outbox SET event_id = JSON_UNQUOTE(JSON_EXTRACT(event, '$.metadata.eventId'))
WHERE event_id IS NULL AND JSON_EXTRACT(event, '$.metadata.eventId') IS NOT NULL;

-- SQLite
UPDATE noddde_outbox SET event_id = json_extract(event, '$.metadata.eventId')
WHERE event_id IS NULL AND json_extract(event, '$.metadata.eventId') IS NOT NULL;
```

Until backfilled, `markPublishedByEventIds` simply won't match those rows —
the same limitation the old in-memory-filter approach already had for any
backlog beyond its 10,000-row cap, so this is not a regression.
