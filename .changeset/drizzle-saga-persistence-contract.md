---
"@noddde/drizzle": patch
---

Fix `DrizzleSagaPersistence` to actually implement the `SagaPersistence` contract: `save()` was missing the `expectedVersion` parameter (silently ignored on every call) and `load()` returned the raw saga state instead of `{ state, version } | null`. The saga executor reads `loaded.state`, so every multi-step saga (any saga reacting to more than one event) silently lost its state after the first transition, then crashed on the next event with `TypeError: Cannot read properties of undefined`.

`sagaStates` now has a `version` column (sqlite/pg/mysql) and `save()`/`load()` use the same optimistic-concurrency pattern as `DrizzleStateStoredAggregatePersistence` (insert when `expectedVersion === 0`, versioned `UPDATE ... WHERE version = expectedVersion` otherwise, `ConcurrencyError` on conflict). Existing `noddde_saga_states` tables need a manual `ALTER TABLE noddde_saga_states ADD COLUMN version INTEGER NOT NULL DEFAULT 0` migration.
