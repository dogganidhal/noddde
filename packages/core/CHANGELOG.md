# @noddde/core

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

## 1.0.0-rc.1

### Minor Changes

- 69b9817: Add `KafkaEventBus.warmup()` / `warmupOnConnect` for Kafka cold-start latency, and a new `EventIdempotencyStore` + `withIdempotency()` primitive (`@noddde/core`) for deduplicating event handler invocations under Kafka/RabbitMQ at-least-once redelivery, with an in-memory implementation in `@noddde/engine` and durable table-backed implementations in `@noddde/typeorm`, `@noddde/drizzle`, and `@noddde/prisma`.

  `@noddde/nats` gets a permanent benchmark test (no API change) documenting that per-subscription inbox-subject memory is negligible at scale — no code change was needed after measuring against a real broker.

- 54a763d: Add an optional per-saga `atomicity` field and the `SagaAtomicity` type (`"atomic" | "best-effort"`) to saga definitions.

  `atomicity` is a declarative field on `defineSaga` / the `Saga` interface; `defineSaga` remains a pure identity function and does not read, validate, or default it. The engine's `SagaExecutor` consumes the field, treating an absent value as `"atomic"` (today's behavior), so existing sagas are unaffected.

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

## 0.3.9

### Patch Changes

- 9a3e3b7: build: emit dual CJS + ESM for all packages via tsup
