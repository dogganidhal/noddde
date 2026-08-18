---
"@noddde/prisma": patch
"@noddde/typeorm": patch
---

Fix `PrismaSagaPersistence` and `TypeORMSagaPersistence` to actually implement the `SagaPersistence` contract (same gap already fixed for `DrizzleSagaPersistence`): `save()` was missing the `expectedVersion` parameter (silently ignored on every call) and `load()` returned the raw saga state instead of `{ state, version } | null`. The saga executor reads `loaded.state`, so every multi-step saga silently lost its state after the first transition, then crashed on the next event.

`noddde_saga_states` now has a `version` column on both adapters, and `save()`/`load()` use the same optimistic-concurrency pattern as their respective `StateStoredAggregatePersistence` implementations (insert when `expectedVersion === 0`, versioned update otherwise, `ConcurrencyError` on conflict). Existing `noddde_saga_states` tables need a manual `ALTER TABLE noddde_saga_states ADD COLUMN version INTEGER NOT NULL DEFAULT 0` migration.

Also fixes the shared `defineSagaContract` integration-test harness (`@noddde/testing-integration`), which still exercised the old 3-argument `save()` / raw-state `load()` shape and was masking this gap on Prisma and TypeORM.
