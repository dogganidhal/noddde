---
"@noddde/engine": patch
---

Fix engine lifecycle/reliability bugs found in the GA-readiness audit (#132, #133):

- **Projection rebuild now applies upcasters** — `rebuildProjection` previously fed raw stored events straight into reducers, so any event whose schema evolved after the first write would silently corrupt rebuilt views. Rebuild now applies the same upcaster chain the aggregate-replay path uses, resolved per-event via `event.metadata.aggregateName`. Live event-bus delivery to projections/sagas still does not upcast — a documented, separate limitation.
- **`OutboxRelay` can no longer crash the process** — a transient `loadUnpublished()` failure (e.g. a DB blip) is now caught and logged instead of becoming an unhandled promise rejection under `start()`'s polling `setInterval`. The relay's at-least-once claim is also now scoped honestly: it holds fully against transport failures, but an in-process `EventBus` that swallows handler errors (e.g. `EventEmitterEventBus`) can still mark an entry published even though a handler failed — documented as a known limitation, not silently overclaimed.
- **Pessimistic locks are held across the owning commit, not just the load phase** — under `withUnitOfWork` or a saga's atomic mode, a pessimistic lock previously released right after the aggregate's lifecycle ran, before the actual write landed at the owning unit of work's `commit()`. A second command could acquire the lock and observe stale state in that window. The lock is now held until the owning UoW actually settles.
- **Snapshots configured via a strategy are no longer dropped inside an explicit UoW** — commands executed via `withUnitOfWork` or saga reactions now get their pending snapshot saved (best-effort) once the owning UoW commits, instead of being silently discarded.
- **Post-commit event publishing no longer runs inside the completed UoW's `AsyncLocalStorage` scope** — a standalone event handler that reacted to an event published from `withUnitOfWork` or a saga commit, and dispatched a command in response, could crash with `"UnitOfWork already completed"` (silently swallowed into a log). Publishing now happens after that scope has exited, so such re-entrant dispatches take a fresh implicit UoW instead.
- **`Domain.shutdown()` no longer leaves a dangling ~30s timer** — the two deadline timers used to race in-flight/outbox draining are now cleared as soon as the race resolves, so a fast shutdown lets the process exit immediately instead of keeping the event loop alive for the rest of `timeoutMs`.
- **Unwired projections fail loud instead of silently misbehaving** — a strong-consistency projection with no wired `ViewStoreFactory` now throws at `init()` (it can never function correctly); an eventual-consistency projection with no wired store now logs a warning instead of failing silently.

Adds a small internal module, `packages/engine/src/uow-completion-hooks.ts`, and an optional `acquireForUow` hook on the (internal, non-exported) `ConcurrencyStrategy` interface — neither is public API.

Saga-state concurrency control (lost-update under concurrent events for one saga instance) requires a `SagaPersistence` interface change and is tracked separately, pending the core API freeze.
