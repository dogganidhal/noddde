# Migrations

## Outbox `event_id` column (pre-GA hardening, issue #131)

`NodddeOutboxEntry` gained a nullable, indexed `eventId` column so
`markPublishedByEventIds` can `UPDATE ... WHERE event_id IN (...)` directly
instead of loading and JSON-parsing up to 10,000 unpublished rows per call.

**Schema change:** run `prisma migrate dev` / `prisma db push` (or your own
migration tooling) after upgrading — this adds the `event_id` column and its
index to `noddde_outbox`.

**Backfill for existing rows:** rows written before this change have
`event_id IS NULL`. Run once, per dialect, to populate it from the JSON
already stored in the `event` column:

```sql
-- PostgreSQL
UPDATE noddde_outbox
SET event_id = event::jsonb -> 'metadata' ->> 'eventId'
WHERE event_id IS NULL;

-- MySQL
UPDATE noddde_outbox
SET event_id = JSON_UNQUOTE(JSON_EXTRACT(event, '$.metadata.eventId'))
WHERE event_id IS NULL;

-- SQLite
UPDATE noddde_outbox
SET event_id = json_extract(event, '$.metadata.eventId')
WHERE event_id IS NULL;
```

Until backfilled, `markPublishedByEventIds` simply won't match old rows by
event id (the same limitation the previous in-memory-scan implementation had
for anything beyond its 10k cap — not a new regression).
