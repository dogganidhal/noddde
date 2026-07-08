---
"@noddde/typeorm": patch
---

Fix `TypeORMStateStoredAggregatePersistence.save()` to throw `ConcurrencyError` (not a raw `QueryFailedError`) when two saves race to create the same brand-new aggregate. The `findOne`-then-insert path had a time-of-check/time-of-use window: both racers saw no existing row and both issued an `INSERT`, and the loser surfaced a raw duplicate-key error. Duplicate-key/unique violations on that path are now mapped to `ConcurrencyError`, matching the event-sourced strategy and the persistence contract. Surfaced by the new concurrent-save race test (ROBUSTNESS.md §2.2).
