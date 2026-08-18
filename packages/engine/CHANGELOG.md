# @noddde/engine

## 1.0.0-rc.2

### Major Changes

- 525513c: 1.0 core API freeze: settle the pre-GA breaking decisions scattered across the GA-readiness audit (issues #132, #133, #135, #144) before adapter/engine lanes rebase onto them. Full rationale and rejected alternatives in `specs/api-freeze.spec.md`.

  Breaking changes:

  - **`SagaPersistence`**: `load` now returns `{ state, version } | null` instead of `any | undefined | null`; `save` now requires an `expectedVersion` argument and throws `ConcurrencyError` on mismatch. Closes the lost-update race where concurrent saga transitions silently overwrote each other.
  - **`IdempotencyStore.save`**: now throws `IdempotencyConflictError` when a record for the given `commandId` already exists, instead of silently overwriting it. `exists()` is now documented as fast-path-only.
  - **`Instrumentation`**: the concrete OTel-backed class exported from `@noddde/engine` is renamed to `OTelInstrumentation`. A new transport-agnostic `Instrumentation` interface (plus `NoopInstrumentation` default) is now exported from `@noddde/core` — public config surfaces should depend on that instead of the concrete engine class.

  Additive (non-breaking):

  - `CommandHandlerRegistry` / `QueryHandlerRegistry`: new optional sub-interfaces of `CommandBus`/`QueryBus` for buses that support local handler registration, making the engine's actual `register()` requirement part of the typed public contract.
  - `LateSubscriptionError`: new shared error type for the `EventBus.on()` late-registration contract (documented in `EventBus.on()`'s JSDoc — late registration for a genuinely new event name is an error on every `Connectable` implementation).
  - `Snapshot` and `StateStoredAggregatePersistence` gain an optional `stateVersion` field/parameter, reserving (but not yet implementing) state-payload schema upcasting.
  - `EventMetadata.causationId` and `Command.commandId` JSDoc tightened to require per-dispatch identifiers, not static command/event names.

### Patch Changes

- ec58bd0: Fix the CLI golden path and release-engineering hygiene ahead of GA (#136, #141):

  - **CLI scaffolds now install and compile.** `noddde new project` no longer pins `@noddde/*` deps at `^0.0.0` (which matched no published version) and no longer depends on the private, unpublished `@noddde/typescript-config` — the generated `tsconfig.json` inlines the base compiler options instead.
  - **Generated query handlers are payload-first**, matching `QueryHandler`'s actual signature (`query.id`, not `query.payload.id`) — fixes `noddde new projection`, `noddde new domain`, and `noddde add query`.
  - **Every event-bus choice compiles.** The Kafka/NATS/RabbitMQ `main.ts` scaffolds now wire the full `CQRSInfrastructure` triple instead of only `eventBus`; the NATS scaffold also supplies the required `consumerGroup`.
  - **`noddde new saga` compiles immediately** — it wires a concrete placeholder event instead of an empty `startedBy: []`, which violated `Saga.startedBy`'s non-empty-tuple type.
  - **Scaffolds use the non-deprecated `defineDomain` form**, exporting `definition` (not `<name>Domain`) plus `InferDomain`-based type — this also makes `noddde diagram`'s default entry path read what `new project`/`new domain` just generated.
  - **`noddde --version` reports the CLI's real version** instead of a hardcoded `0.0.0`.
  - Added a "compile the scaffold" test harness (`packages/cli/src/__tests__/scaffold-compile.test.ts`) that resolves every generator's output against the real, built `@noddde/*` packages and runs `tsc --noEmit` — closing the gap that let the above drift ship green under string-containment-only tests.
  - **Every published tarball now ships its LICENSE file** (verified via `npm pack --dry-run`).
  - **Internal `@noddde/*` dependencies use caret ranges** instead of exact pins, so npm/yarn can dedupe to a single `@noddde/core` install — an exact pin risked a duplicate copy silently breaking `ConcurrencyError`/`DeleteView` identity checks in `@noddde/engine`.
  - **Peer ranges are now honest about what's tested**: `drizzle-orm` (`>=0.30.0 <0.46.0`), `typeorm` (`>=0.3.0 <0.4.0`), and `amqplib` (`>=0.10.0 <0.11.0`) no longer claim compatibility with untested major/minor lines.
  - Added an `engines` field (`node >=22`, matching what CI actually builds against) to every published package.
  - `yarn release` now runs the test suite and re-syncs per-package LICENSE files before `changeset publish`.
  - `@noddde/prisma` no longer ships its integration-test-only Postgres/MySQL Prisma schemas in the published tarball.

- aed710c: Fix engine lifecycle/reliability bugs found in the GA-readiness audit (#132, #133):

  - **Projection rebuild now applies upcasters** — `rebuildProjection` previously fed raw stored events straight into reducers, so any event whose schema evolved after the first write would silently corrupt rebuilt views. Rebuild now applies the same upcaster chain the aggregate-replay path uses, resolved per-event via `event.metadata.aggregateName`. Live event-bus delivery to projections/sagas still does not upcast — a documented, separate limitation.
  - **`OutboxRelay` can no longer crash the process** — a transient `loadUnpublished()` failure (e.g. a DB blip) is now caught and logged instead of becoming an unhandled promise rejection under `start()`'s polling `setInterval`. The relay's at-least-once claim is also now scoped honestly: it holds fully against transport failures, but an in-process `EventBus` that swallows handler errors (e.g. `EventEmitterEventBus`) can still mark an entry published even though a handler failed — documented as a known limitation, not silently overclaimed.
  - **Pessimistic locks are held across the owning commit, not just the load phase** — under `withUnitOfWork` or a saga's atomic mode, a pessimistic lock previously released right after the aggregate's lifecycle ran, before the actual write landed at the owning unit of work's `commit()`. A second command could acquire the lock and observe stale state in that window. The lock is now held until the owning UoW actually settles.
  - **Snapshots configured via a strategy are no longer dropped inside an explicit UoW** — commands executed via `withUnitOfWork` or saga reactions now get their pending snapshot saved (best-effort) once the owning UoW commits, instead of being silently discarded.
  - **Post-commit event publishing no longer runs inside the completed UoW's `AsyncLocalStorage` scope** — a standalone event handler that reacted to an event published from `withUnitOfWork` or a saga commit, and dispatched a command in response, could crash with `"UnitOfWork already completed"` (silently swallowed into a log). Publishing now happens after that scope has exited, so such re-entrant dispatches take a fresh implicit UoW instead.
  - **`Domain.shutdown()` no longer leaves a dangling ~30s timer** — the two deadline timers used to race in-flight/outbox draining are now cleared as soon as the race resolves, so a fast shutdown lets the process exit immediately instead of keeping the event loop alive for the rest of `timeoutMs`.
  - **Unwired projections fail loud instead of silently misbehaving** — a strong-consistency projection with no wired `ViewStoreFactory` now throws at `init()` (it can never function correctly); an eventual-consistency projection with no wired store now logs a warning instead of failing silently.

  Adds a small internal module, `packages/engine/src/uow-completion-hooks.ts`, and an optional `acquireForUow` hook on the (internal, non-exported) `ConcurrencyStrategy` interface — neither is public API.

  Saga-state concurrency control (lost-update under concurrent events for one saga instance) requires a `SagaPersistence` interface change and is tracked separately, pending the core API freeze.

- Updated dependencies [ec58bd0]
- Updated dependencies [525513c]
  - @noddde/core@1.0.0-rc.2

## 1.0.0-rc.1

### Minor Changes

- 69b9817: Add `KafkaEventBus.warmup()` / `warmupOnConnect` for Kafka cold-start latency, and a new `EventIdempotencyStore` + `withIdempotency()` primitive (`@noddde/core`) for deduplicating event handler invocations under Kafka/RabbitMQ at-least-once redelivery, with an in-memory implementation in `@noddde/engine` and durable table-backed implementations in `@noddde/typeorm`, `@noddde/drizzle`, and `@noddde/prisma`.

  `@noddde/nats` gets a permanent benchmark test (no API change) documenting that per-subscription inbox-subject memory is negligible at scale — no code change was needed after measuring against a real broker.

- e6d3e39: `SagaExecutor` now honors a per-saga `atomicity` mode (`saga.atomicity ?? "atomic"`):

  - **`atomic`** (default) — unchanged: the saga's unit of work spans the saga-state save and all reaction commands, so they commit or roll back together.
  - **`best-effort`** — commits the saga state first, then dispatches reaction commands outside that unit of work (each command obtains its own UoW via `CommandLifecycleExecutor`). Command handlers that publish events directly through the event bus — and the re-entrant saga executions they trigger — therefore observe the committed saga state, fixing the silent event loss in issue #119. Trade-off: a reaction-command failure no longer rolls back the saga-state transition.

  Sagas that do not set `atomicity` keep their current transactional behavior.

### Patch Changes

- Updated dependencies [69b9817]
- Updated dependencies [54a763d]
  - @noddde/core@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- e03a054: First release candidate for v1.0.0.

  This kicks off the pre-release cycle ahead of the stable v1.0.0 release. The public API surface is now considered stable; subsequent `rc` builds will focus on stabilization, documentation, and adapter robustness based on community feedback.

  Highlights since 0.3.9:

  - **Adapters** — pg/mysql portability fixes across Drizzle/Prisma/TypeORM (timestamp encoding, advisory-lock return shapes, optimistic-concurrency detection on mysql2). NATS push consumers now declare an explicit `deliverTo` inbox (required by NATS Server >= 2.10). Kafka `connect()` waits for `GROUP_JOIN` so producers can't publish into the consumer's not-yet-joined window.
  - **Build output** — all packages now ship dual CJS and ESM bundles.
  - **Type system** — stress-tested across core and engine; results captured in `specs/reports/type-perf.md`.
  - **Docs** — full pre-GA audit pass across the documentation site (API drift, naming, broken links, structure).
  - **Integration testing** — adapter integration test suite with testcontainers + path-filtered CI lane.

### Patch Changes

- Updated dependencies [e03a054]
  - @noddde/core@1.0.0-rc.0

## 0.3.9

### Patch Changes

- 9a3e3b7: build: emit dual CJS + ESM for all packages via tsup
- 40ba3d3: polish(v1): projection handler init refactor + NestJS README + audit annotation
- Updated dependencies [9a3e3b7]
  - @noddde/core@0.3.9
