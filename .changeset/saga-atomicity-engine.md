---
"@noddde/engine": minor
---

`SagaExecutor` now honors a per-saga `atomicity` mode (`saga.atomicity ?? "atomic"`):

- **`atomic`** (default) — unchanged: the saga's unit of work spans the saga-state save and all reaction commands, so they commit or roll back together.
- **`best-effort`** — commits the saga state first, then dispatches reaction commands outside that unit of work (each command obtains its own UoW via `CommandLifecycleExecutor`). Command handlers that publish events directly through the event bus — and the re-entrant saga executions they trigger — therefore observe the committed saga state, fixing the silent event loss in issue #119. Trade-off: a reaction-command failure no longer rolls back the saga-state transition.

Sagas that do not set `atomicity` keep their current transactional behavior.
