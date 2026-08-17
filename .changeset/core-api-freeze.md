---
"@noddde/core": major
"@noddde/engine": major
---

1.0 core API freeze: settle the pre-GA breaking decisions scattered across the GA-readiness audit (issues #132, #133, #135, #144) before adapter/engine lanes rebase onto them. Full rationale and rejected alternatives in `specs/api-freeze.spec.md`.

Breaking changes:

- **`SagaPersistence`**: `load` now returns `{ state, version } | null` instead of `any | undefined | null`; `save` now requires an `expectedVersion` argument and throws `ConcurrencyError` on mismatch. Closes the lost-update race where concurrent saga transitions silently overwrote each other.
- **`IdempotencyStore.save`**: now throws `IdempotencyConflictError` when a record for the given `commandId` already exists, instead of silently overwriting it. `exists()` is now documented as fast-path-only.
- **`Instrumentation`**: the concrete OTel-backed class exported from `@noddde/engine` is renamed to `OTelInstrumentation`. A new transport-agnostic `Instrumentation` interface (plus `NoopInstrumentation` default) is now exported from `@noddde/core` — public config surfaces should depend on that instead of the concrete engine class.

Additive (non-breaking):

- `CommandHandlerRegistry` / `QueryHandlerRegistry`: new optional sub-interfaces of `CommandBus`/`QueryBus` for buses that support local handler registration, making the engine's actual `register()` requirement part of the typed public contract.
- `LateSubscriptionError`: new shared error type for the `EventBus.on()` late-registration contract (documented in `EventBus.on()`'s JSDoc — late registration for a genuinely new event name is an error on every `Connectable` implementation).
- `Snapshot` and `StateStoredAggregatePersistence` gain an optional `stateVersion` field/parameter, reserving (but not yet implementing) state-payload schema upcasting.
- `EventMetadata.causationId` and `Command.commandId` JSDoc tightened to require per-dispatch identifiers, not static command/event names.
