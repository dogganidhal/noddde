---
title: "1.0 Core API Freeze — Decision Record"
module: api-freeze
source_file: N/A (cross-cutting decision record; implementing changes live in packages/core/src/** and packages/engine/src/implementations/**)
status: implemented
exports: []
depends_on:
  [
    persistence,
    persistence/snapshot,
    persistence/idempotency,
    cqrs/command-bus,
    cqrs/query-bus,
    edd/event-bus,
    edd/event-metadata,
    infrastructure,
  ]
docs:
  - support/compatibility.mdx
---

# 1.0 Core API Freeze — Decision Record

> Lane 0c of the noddde GA push. The GA-readiness audit of `1.0.0-rc.1` (commit `dec6f7d`, full report: https://claude.ai/code/artifact/b56dd4db-88ca-452f-bfc0-e894dca69481) scattered ~12 pre-GA breaking API decisions across issues #132, #133, #135, #136, #138, #142, #144, plus one undocumented finding (the snapshot/state-stored schema-version gap) and one phantom decision ("API Decision #1", referenced by #133 but never recorded anywhere). Every one of these cascades into 4+ downstream packages. This document makes each decision once, so lanes A (SQL adapters), B (engine), C (messaging), D (CLI), E (NestJS) rebase onto a settled surface instead of re-deciding independently and colliding.
>
> Scope: core-side interface decisions + their in-memory implementations only. Adapter columns, engine call sites, CLI templates, and docs pages are named explicitly per decision for the owning lane to pick up — this record does not implement them.

## Decisions

### 1. `CommandResult` / the "API Decision #1" `idempotent` field — DEFERRED to post-1.0

**Chosen:** `CommandBus.dispatch(command): Promise<void>` ships unchanged at 1.0. No `CommandResult` return type, no `idempotent` field.

**Rejected alternatives:**

- Ship `CommandResult { idempotent: boolean }` now, with `idempotent` computed from today's check-then-act `IdempotencyStore.exists()` race (see #133). Rejected: the field would be semver-frozen while still unreliable under concurrency — issue #133's own scope update makes this an explicit dependency ("the `CommandResult.idempotent` field ... must not ship until this issue closes"). A wrong field shipped at 1.0 cannot be fixed without a breaking change; an absent field can be added later without one.
- Ship `CommandResult {}` (empty, no `idempotent`) now as a placeholder to reserve the return-type shape. Rejected: `CommandBus.dispatch` returning `Promise<void>` today means any custom `CommandBus` implementation (a documented extension point) returns `Promise<void>`. Changing the interface's return type to `Promise<CommandResult>` is _itself_ a breaking change for implementers regardless of `CommandResult`'s field count, so there is no cost saved by shipping the empty shape now — the same break happens whenever `CommandResult` is actually introduced. No reason to eat it before there's a real field to justify it.

**Rationale:** Deferring is a legitimate GA answer here. `CommandBus` interface (`packages/core/src/cqrs/command/command-bus.ts`) is unchanged.

**Downstream:** When atomic idempotency (Decision 5 below + issue #133's hoist-to-`Domain.dispatchCommand`) has shipped and proven reliable in a post-1.0 minor, introduce `CommandResult { idempotent: boolean }` then, as a new major-version interface change (breaking for `CommandBus` implementers) — not before. No lane has follow-up work here for 1.0.

---

### 2. `SagaPersistence` optimistic concurrency — versioned load/save

**Chosen:** Mirror `StateStoredAggregatePersistence`'s existing shape exactly:

```ts
interface SagaPersistence {
  load(
    sagaName: string,
    sagaId: ID,
  ): Promise<{ state: any; version: number } | null>;
  save(
    sagaName: string,
    sagaId: ID,
    state: any,
    expectedVersion: number,
  ): Promise<void>;
}
```

`load` returns `null` for a saga instance that doesn't exist yet (version implicitly 0, same convention as state-stored aggregates). `save` throws `ConcurrencyError` (already exported from `packages/core/src/persistence`, reused as-is — no new error type) when `expectedVersion` doesn't match the stored version. On success the stored version increments by 1.

**Rejected alternatives:**

- Add a separate `version` out-parameter or a `SagaConcurrencyError` subclass. Rejected: `ConcurrencyError` is already generic over "aggregateName"/"aggregateId" naming, and state-stored aggregate persistence already proves the `{state, version}` + `expectedVersion` shape works for exactly this "opaque state blob with an integer version" case. Reusing it means one error type for callers to catch, and zero new public surface.
- Event-source sagas instead of state-storing them (append a stream of saga-state-transition events). Rejected: out of scope — sagas are explicitly state-stored per the existing spec ("Sagas use state-stored persistence... because they track workflow progress, not domain truth"); rev isiting that is a much bigger change than this freeze item calls for.

**Breaking change:** Yes — `SagaPersistence.save`/`load` signatures change (this is exactly why #132 calls it "API locked at GA" and requires action pre-GA rather than post).

**Implemented (this lane):**

- `packages/core/src/persistence/index.ts` — `SagaPersistence` interface updated.
- `packages/engine/src/implementations/in-memory-saga-persistence.ts` — `InMemorySagaPersistence` now stores `{state, version}` per key, checks `expectedVersion`, throws `ConcurrencyError` on mismatch.
- `specs/core/persistence/persistence.spec.md`, `specs/engine/implementations/in-memory-saga-persistence.spec.md` updated with the new contract and test scenarios.

**Downstream (not implemented by this lane):**

- **Lane B** — `packages/engine/src/executors/saga-executor.ts:76,230-232` must thread the loaded `version` through to `save`, and retry or serialize on `ConcurrencyError` (issue #132's suggested fix: "retry or serialize per saga id"). This is the actual concurrency-safety fix; the interface change alone only makes the race _detectable_.
- **Lane A** — the three SQL adapters' `SagaPersistence` implementations need a `saga_states` version column (integer, default 0) and the same optimistic-check-then-increment logic as their existing state-stored aggregate persistence. Same pattern already exists in each adapter for aggregate state-storage — port it.

---

### 3. `CommandBus` / `QueryBus` registration — typed `HandlerRegistry` sub-interfaces

**Chosen:** Add two new, optional-to-implement sub-interfaces rather than folding `register` into `CommandBus`/`QueryBus` themselves:

```ts
// cqrs/command/command-bus.ts
interface CommandHandlerRegistry {
  register(
    commandName: string,
    handler: (command: Command) => void | Promise<void>,
  ): void;
}

// cqrs/query/query-bus.ts
interface QueryHandlerRegistry {
  register(
    queryName: string,
    handler: (payload: any) => any | Promise<any>,
  ): void;
}
```

`InMemoryCommandBus implements CommandBus, CommandHandlerRegistry` and `InMemoryQueryBus implements QueryBus, QueryHandlerRegistry` explicitly now (previously implicit/structural only). `CommandBus`/`QueryBus` themselves stay dispatch-only.

**Rejected alternatives:**

- Fold `register` directly into `CommandBus`/`QueryBus`. Rejected: a remote/RPC command bus (dispatch to a different process/service) is a legitimate `CommandBus` implementation that structurally cannot support local handler registration — forcing `register` into the base interface would make that class of implementation impossible to type correctly. The engine only ever calls `register` on the bus _it_ provides as the default (or that a user explicitly opts into local dispatch with); it should not be mandatory for every conceivable `CommandBus`.
- Leave the interface as-is and just make the engine's cast into a documented "hidden contract" (status quo). Rejected: this is exactly what #133 flags as the defect — the requirement to implement `register()` is invisible in the type system, so a user implementing the _documented_ public interface gets a runtime `TypeError` at init with no compile-time signal.

**Breaking change:** Additive/non-breaking for `CommandBus`/`QueryBus` themselves (new sibling interfaces, no existing signatures touched). Becomes a real (compile-time, desirable) breaking change only where Lane B tightens the engine's internal typing to require `CommandHandlerRegistry`/`QueryHandlerRegistry` on wired buses (see Downstream).

**Implemented (this lane):**

- `packages/core/src/cqrs/command/command-bus.ts` — added `CommandHandlerRegistry`.
- `packages/core/src/cqrs/query/query-bus.ts` — added `QueryHandlerRegistry`.
- `packages/engine/src/implementations/in-memory-command-bus.ts`, `in-memory-query-bus.ts` — explicit `implements` clauses added (behavior unchanged, this was already structurally true).
- `specs/core/cqrs/command-bus.spec.md`, `specs/core/cqrs/query-bus.spec.md` updated.

**Downstream (not implemented by this lane):**

- **Lane B** — `packages/engine/src/domain.ts:994,1015,1025,1045,1065` currently does `(commandBus as InMemoryCommandBus).register(...)`. Replace the blind cast with: type the wired bus as `CommandBus & Partial<CommandHandlerRegistry>` (or check `typeof commandBus.register === "function"`), and if `register` is structurally absent, **throw a clear init-time error** ("Custom CommandBus wired via `DomainWiring.buses` does not implement `CommandHandlerRegistry.register()` — aggregate/standalone command routing requires it.") instead of the current opaque `TypeError: commandBus.register is not a function`. Same for `QueryBus`/`QueryHandlerRegistry` at the two query-registration call sites. This closes #133's "fail loud at init" finding, which is explicitly in that issue's non-breaking scope.

---

### 4. `causationId` — contract tightened, no type change; auto-generation is an engine fix

**Chosen:** `EventMetadata.causationId` stays `string` (required) — the type doesn't change. Its JSDoc is tightened to state explicitly: the value **must** be a per-dispatch identifier (a `commandId` or a causing event's `eventId`), and **must never** be a static command/event _name_. `Command.commandId` JSDoc is extended to note that once the engine auto-generates a `commandId` for causation purposes, it does so per dispatch (not per command type).

**Rejected alternatives:**

- Make `causationId` optional (`causationId?: string`). Rejected: the field's entire purpose is audit/correlation; making it optional lets the real fix (auto-generate an id) get skipped and just documents the hole instead of closing it. The audit's own suggested fix lists this as an "and/or" fallback, not the primary fix.
- Change `Command.commandId` from optional to required. Rejected: would force every caller of every command everywhere to supply an id even when they don't care about idempotency or causation tracking — a much bigger breaking change than necessary. Auto-generation at the engine's dispatch boundary (only when the caller omitted one) gets the same causation-integrity benefit without forcing the field on every call site.

**Breaking change:** No type change in core. The _behavioral_ fix (stop collapsing every `CreateBooking`-caused event's `causationId` to the literal string `"CreateBooking"`) is a bug fix, not a freeze item — but it touches persisted data, so get it right before GA since old bad values are unrepairable.

**Implemented (this lane):**

- `packages/core/src/edd/event-metadata.ts` — `causationId` JSDoc tightened.
- `packages/core/src/cqrs/command/command.ts` — `commandId` JSDoc extended.

**Downstream (not implemented by this lane — engine's dispatch path is Lane B's exclusive file):**

- **Lane B** — `packages/engine/src/executors/metadata-enricher.ts:34,53` currently falls back to the command _name_ as `causationFallback`. Fix: at the point `Domain.dispatchCommand` (or wherever commands first enter the engine) sees no `command.commandId`, generate one with `uuidv7()` (already available in `packages/engine/src/uuid.ts`, used today for `eventId`) and pass that generated id down as both the command's effective id and the causation fallback. This is a pure engine-internal fix; no core signature changes are required to implement it.

---

### 5. `IdempotencyStore` conflict signal — atomic claim via `IdempotencyConflictError`

**Chosen:** `IdempotencyStore.save` no longer silently overwrites. It throws a new `IdempotencyConflictError` when a record for the same `commandId` already exists, mirroring the `ConcurrencyError` pattern used everywhere else in `persistence/`:

```ts
class IdempotencyConflictError extends Error {
  readonly name: "IdempotencyConflictError";
  readonly commandId: ID;
  constructor(commandId: ID);
}

interface IdempotencyStore {
  exists(commandId: ID): Promise<boolean>;
  /** Throws {@link IdempotencyConflictError} if a record for `record.commandId` already exists. */
  save(record: IdempotencyRecord): Promise<void>;
  remove(commandId: ID): Promise<void>;
  removeExpired(ttlMs: number): Promise<void>;
}
```

`exists()` is kept as documented fast-path-only (JSDoc now says explicitly: "This is a fast-path check; the authoritative duplicate signal is a conflict thrown from `save()`.").

**Rejected alternatives:**

- Return a boolean from `save` (`Promise<boolean>`, `true` = "was already claimed"). Rejected: `Promise<void>` failure-as-exception is the idiom already used by `ConcurrencyError`/`save()` in the same file family (`StateStoredAggregatePersistence.save`, `EventSourcedAggregatePersistence.save`). A boolean return is also easy to silently ignore (`await store.save(record)` with no `if`), whereas an uncaught throw fails loudly — matching this store's job of being the last line of defense against double-processing.
- Add a separate `claim(commandId): Promise<boolean>` method instead of changing `save`. Rejected: would require every implementation to keep two write paths in sync (claim-then-save vs. save-alone) for no behavioral gain — `save` is already the single write; making it conflict-aware is the minimal change.

**Breaking change:** Yes — `save()`'s failure mode changes from "silent overwrite" to "throws on duplicate." Any code relying on overwrite-on-duplicate (there is none in this repo — `save` is only ever called after `exists()` returned `false`, per #133) must now handle/expect `IdempotencyConflictError`.

**Implemented (this lane):**

- `packages/core/src/persistence/idempotency-conflict-error.ts` (new) — `IdempotencyConflictError`, exported from `packages/core/src/persistence/index.ts`.
- `packages/core/src/persistence/idempotency.ts` — `IdempotencyStore.save` JSDoc updated to document the throw; `exists()` JSDoc clarified as fast-path-only.
- `packages/engine/src/implementations/in-memory-idempotency-store.ts` — `InMemoryIdempotencyStore.save` now checks for an existing non-expired record and throws `IdempotencyConflictError` instead of overwriting.
- `specs/core/persistence/idempotency.spec.md`, `specs/engine/implementations/in-memory-idempotency-store.spec.md` updated.

**Downstream (not implemented by this lane — issue #133's "Scope update" is the full spec for this work):**

- **Lane B** — three concrete changes to `packages/engine/src/executors/command-lifecycle-executor.ts` and `packages/engine/src/domain.ts` (`Domain.dispatchCommand`):
  1. Hoist the dedup check from `command-lifecycle-executor.ts:82-94` up to `Domain.dispatchCommand`, before the aggregate-vs-standalone branch, so both command kinds share one implementation.
  2. For aggregate commands: keep the idempotency-record `save()` enlisted in the same `UnitOfWork` as the produced events (already true today per `command-lifecycle-executor.ts:349-359`), but now catch `IdempotencyConflictError` from that enlisted `save()` at commit time and treat it as the duplicate signal (roll back, do not publish events, report duplicate) — this is the actual atomic-claim fix `ConcurrencyError`-style commit-time conflict detection.
  3. For standalone commands (no transactional boundary): apply best-effort dedup (claim-before-run or mark-after-run) using the same `IdempotencyStore`, and document in JSDoc + docs that standalone dedup is best-effort while aggregate dedup is transactional — do not blur the two guarantees together.
- **Lane A** — the three SQL `IdempotencyStore` implementations need their `save()` to map their store's unique-constraint violation (Prisma `P2002`, Postgres `23505`, etc. — same error-taxonomy work already flagged as inconsistent across adapters in #144) to `IdempotencyConflictError`, not swallow or misclassify it.

---

### 6. `EventBus` late-`on()` contract — one contract, in core JSDoc, plus a shared error type

**Chosen:** Document the contract directly on `EventBus.on()` in `packages/core/src/edd/event-bus.ts`: registering a handler for an event name that was **not** already registered before the bus connected is an error, on every implementation. Re-registering an additional handler for an event name that **was** registered pre-connect (ordinary fan-out) remains allowed at any time. Add one shared error type, `LateSubscriptionError`, so all three broker adapters raise the same class instead of ad hoc `Error`s or silent no-ops:

```ts
class LateSubscriptionError extends Error {
  readonly name: "LateSubscriptionError";
  readonly eventName: string;
  constructor(eventName: string);
}
```

This picks the audit's own recommendation ("late `on()` for a new event name is an error everywhere ... it is the only behavior all three brokers can honor") rather than inventing a fourth behavior.

**Rejected alternatives:**

- Standardize on RabbitMQ's or NATS's current behavior (best-effort silent accept / fire-and-forget accept). Rejected: both are unimplementable on Kafka without buffering messages for a topic the running consumer group isn't subscribed to yet — "throw" is the only behavior achievable by all three, per the audit.
- Leave the contract undefined and just fix each adapter's specific bug (RabbitMQ's empty catch, NATS's missing already-subscribed guard) without a shared statement. Rejected: #135 explicitly frames this as "three different contracts for the same core interface" — fixing bugs without fixing the contract just produces three different _correct-looking_ behaviors, still incompatible.

**Breaking change:** No type signature change (`on(eventName, handler): void` is unchanged). Behavioral contract is now specified where it previously wasn't; RabbitMQ and NATS adapters (Lane C) must change from accept-and-degrade to throw to comply — that's a behavior change in those adapters, not in core.

**Implemented (this lane):**

- `packages/core/src/edd/late-subscription-error.ts` (new) — `LateSubscriptionError`, exported from `packages/core/src/edd/index.ts`.
- `packages/core/src/edd/event-bus.ts` — `on()` JSDoc states the late-registration contract explicitly.
- **No in-memory engine change**: `EventEmitterEventBus` (`packages/engine/src/implementations/ee-event-bus.ts`) does not implement `Connectable` and has no connect phase — every `on()` call is always "pre-connect" for it, so the contract is trivially satisfied and no code changes.
- `specs/core/edd/event-bus.spec.md` updated.

**Downstream (not implemented by this lane):**

- **Lane C** — align all three broker adapters to throw `LateSubscriptionError` (imported from `@noddde/core`) for a genuinely new event name registered after `connect()`:
  - `packages/adapters/kafka/src/kafka-event-bus.ts:353-362` already throws a plain `Error` — swap to `LateSubscriptionError` for consistency.
  - `packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts:402-406` currently accepts silently with an empty catch — must throw synchronously instead (also closes the separate "silent event loss" finding in #135, since that empty catch disappears).
  - `packages/adapters/nats/src/nats-event-bus.ts:141-144` currently fire-and-forgets and lacks an already-subscribed guard — must add the guard (already-subscribed name → allowed, ordinary fan-out) and throw `LateSubscriptionError` for a new name.

---

### 7. `Instrumentation` — abstraction moved to core; engine keeps the OTel-backed implementation

**Chosen:** Add an `Instrumentation` **interface** (not the concrete OTel wrapper) plus a `NoopInstrumentation` default implementation to `@noddde/core` (`packages/core/src/infrastructure/instrumentation.ts`), with the same method surface as the engine's existing concrete class (`withSpan`, `injectTraceContext`, `getActiveTraceCorrelation`, `withExtractedContext`). The engine's concrete OTel-backed class is renamed `OTelInstrumentation` and now `implements` the core `Instrumentation` interface; `detectOTel()` is unchanged. `EventEmitterEventBus`'s `instrumentation?` config field is retyped to the core `Instrumentation` interface, defaulting to `new NoopInstrumentation()` instead of `new Instrumentation(null)`.

**Rejected alternatives:**

- Leave `Instrumentation` as a concrete class in `@noddde/engine` and just document that messaging adapters "happen to" depend on it. Rejected: this is precisely #144's finding — messaging adapters take a full runtime dependency on `@noddde/engine` (not just `@noddde/core`) for a logger default and a tracing wrapper, and their public config types expose a concrete engine class, so third parties can't supply their own instrumentation without constructing engine's class.
- Move the whole concrete OTel implementation into core (so core takes on the `@opentelemetry/api` optional-peer-dependency dance). Rejected: `@noddde/core` has zero runtime dependencies by design (see `CLAUDE.md`); OTel detection/wiring is squarely an engine (runtime) concern. Only the _abstraction_ belongs in core.

**Breaking change:** Yes, but pre-GA and cheap now: anyone importing `Instrumentation` (the class) from `@noddde/engine` today must switch to `OTelInstrumentation`. Grep shows no external consumers (`0.3.9` on npm predates this class); the only in-repo consumers are the three messaging adapters (Lane C, see below) and `packages/engine/src/implementations/ee-event-bus.ts` (fixed by this lane).

**Implemented (this lane):**

- `packages/core/src/infrastructure/instrumentation.ts` (new) — `Instrumentation` interface, `NoopInstrumentation` class.
- `packages/core/src/infrastructure/index.ts` — exports both.
- `packages/engine/src/tracing.ts` — class renamed `Instrumentation` → `OTelInstrumentation`, now `implements Instrumentation` (imported as a type from `@noddde/core`).
- `packages/engine/src/index.ts` — barrel export updated (`OTelInstrumentation` instead of `Instrumentation`; `Instrumentation` the interface is re-exported from `@noddde/core`, not duplicated here).
- `packages/engine/src/implementations/ee-event-bus.ts` — `instrumentation?: Instrumentation` now types against the core interface; default is `new NoopInstrumentation()`.
- `specs/core/infrastructure/instrumentation.spec.md` (new), `specs/engine/tracing.spec.md`, `specs/engine/implementations/ee-event-bus.spec.md` updated.

**Downstream (not implemented by this lane):**

- **Lane C** — for each of `packages/adapters/{kafka,nats,rabbitmq}/src/*-event-bus.ts`:
  - Swap `import { Instrumentation, NodddeLogger } from "@noddde/engine"` for `import type { Instrumentation } from "@noddde/core"` (the `NodddeLogger` default-logger import must also move — see note below) — config field types (`kafka:46`, `rabbitmq:89`, `nats:43`) become the core interface.
  - Default instrumentation instances (currently presumably `new Instrumentation(null)`-shaped) become `new NoopInstrumentation()` from `@noddde/core`.
  - Drop `@noddde/engine` from all three adapters' `package.json` dependencies.
  - **Note on `NodddeLogger`:** the audit's evidence line for this finding also shows `NodddeLogger` imported from `@noddde/engine` alongside `Instrumentation` in all three adapters. `NodddeLogger` is a concrete formatting implementation (color/JSON output), not an abstraction question — this decision record does not move it. If Lane C wants to fully zero out the `@noddde/engine` dependency, it should default to a small local no-op/console logger inside each adapter, or accept `Logger` (already core, interface-only) as a required-ish config field with no framework-provided default. Recorded as an open item for Lane C to resolve; not part of this freeze.

---

### 8. Snapshot / state-stored schema-version envelope — NEW, filed as an issue, envelope only (no upcasting in 1.0)

**Chosen:** Add an optional `stateVersion?: number` field, orthogonal to the existing `version` (stream position / OCC counter), to both:

- `Snapshot` (`packages/core/src/persistence/snapshot.ts`) — the field sits alongside `state`.
- `StateStoredAggregatePersistence` (`packages/core/src/persistence/index.ts`) — `load()`'s return type gains `stateVersion?: number`; `save()` gains an optional 5th parameter `stateVersion?: number`.

Absent `stateVersion` means "implicitly schema version 1" (i.e. pre-envelope data, or a caller that never set it) — this keeps the addition non-breaking for every existing caller and implementation. **Upcasting of stored state/snapshots to a newer `stateVersion` is explicitly NOT implemented in 1.0.** The envelope only _reserves the capability_ to add it later without another on-disk format break. This mirrors decision 1's logic: an absent capability can be added later; a wrong or half-built one (e.g. upcasting wired for snapshots but not dedicated state-stored rows, or vice versa) would be worse than not having it.

**Rejected alternatives:**

- A wrapper type (`{ envelope: { schemaVersion: number }, payload: T }`) instead of a sibling field. Rejected: every persistence adapter and every call site that reads `.state` today would need to change shape, not just add a field — far larger blast radius for the same capability, and this is exactly the kind of change decision 8 exists to make cheap _now_ rather than expensive after GA.
- Ship state upcasting in 1.0 alongside the envelope. Rejected: there is currently no registration point for state upcasters at all (`Aggregate.upcasters` only covers events per #132's projection-rebuild finding), and wiring one requires engine changes in `command-lifecycle-executor.ts` (Lane B's exclusive file, off-limits to this lane) plus new adapter columns (Lane A). Reserving the field now and implementing upcasting as a 1.1 addition is strictly cheaper than blocking GA on it, and additive later either way.
- Piggyback on the existing `version` field instead of adding a new one. Rejected: `version` already has a load-bearing meaning (event-stream position / OCC counter) documented and tested throughout `persistence.spec.md`; overloading it with schema-version semantics is exactly the bug this decision exists to fix, not a fix for it.

**Breaking change:** No — purely additive (`stateVersion?` optional everywhere). Not shipping upcasting logic means this alone does **not** fix the silent-corruption risk the audit found; it only stops the freeze window from closing on the fix.

**Implemented (this lane):**

- `packages/core/src/persistence/snapshot.ts` — `Snapshot.stateVersion?: number`.
- `packages/core/src/persistence/index.ts` — `StateStoredAggregatePersistence.load`/`save` updated.
- `packages/engine/src/implementations/in-memory-snapshot-store.ts`, `in-memory-aggregate-persistence.ts` (the `InMemoryStateStoredAggregatePersistence` class) — pass `stateVersion` through unchanged (store/return it if provided; `undefined` otherwise). No upcasting logic added.
- `specs/core/persistence/snapshot.spec.md`, `specs/core/persistence/persistence.spec.md`, `specs/engine/implementations/in-memory-snapshot-store.spec.md`, `specs/engine/implementations/in-memory-aggregate-persistence.spec.md` updated.
- **Filed as issue #152** — https://github.com/dogganidhal/noddde/issues/152 (repo-owner confirmed before posting, per this lane's brief).

**Downstream (not implemented by this lane):**

- **Lane A** — add a `state_version` (or `stateVersion`) integer column, default `1`, to every dedicated state-stored table and every snapshot table across Drizzle/Prisma/TypeORM schemas; thread it through each adapter's `save`/`load`.
- **Lane B** (post-GA, v1.1 candidate — do not block GA on this) — design and wire an `Aggregate.stateUpcasters`-style registration point, and call it in `command-lifecycle-executor.ts` wherever `StateStoredAggregatePersistence.load()` / `SnapshotStore.load()` results are consumed, mirroring how `upcastEvents` is already called for event-sourced replay.

#### Tracking issue

Filed as [issue #152](https://github.com/dogganidhal/noddde/issues/152): "State-stored / snapshot payloads have no schema-version envelope — silent corruption on aggregate-state schema evolution."

---

### 9. `DomainWiring.buses` partiality — decide only (Lane B implements)

**Chosen: Option B** — `DomainWiring.buses` accepts returning `Partial<CQRSInfrastructure>`; the engine fills in in-memory defaults (`InMemoryCommandBus`, `InMemoryQueryBus`) for any bus the factory omits.

**Rejected alternative: Option A** — require the full triple (`commandBus`, `eventBus`, `queryBus`) from every `buses()` factory, and fix docs/templates to always emit all three. Rejected: the same mistake (`buses: () => ({ eventBus: new KafkaEventBus(...) })`) has already independently reproduced in the CLI's Kafka/NATS/RabbitMQ project templates (#136) _and_ all three event-bus adapter docs pages _and_ the running/infrastructure guide (#138) — six-plus independent authors made the identical "only override the bus I'm actually changing" assumption. A recurring footgun this consistent is a signal about the natural mental model, not six unrelated typos. Option A also means every broker-adoption snippet forever needs three imports and three constructions when the user only cares about one.

**Rationale:** Adopting a broker for events (the overwhelmingly common case — commands and queries usually stay in-process even when events go to Kafka/NATS/RabbitMQ) should require writing only the bus that's actually changing. `CQRSInfrastructure` itself (`packages/core/src/infrastructure/index.ts`) is unchanged by this decision — `Partial<CQRSInfrastructure>` is a TypeScript utility applied at the `DomainWiring.buses` type in engine, not a core interface change.

**Breaking change:** No core change at all. It is a signature change to `DomainWiring.buses` in `packages/engine/src/domain.ts:336-339`, entirely within Lane B's file.

**This lane implements nothing for decision 9** — no core file is touched, per the brief ("`DomainWiring` lives in `engine/src/domain.ts` (Lane B's file)... you decide and record; they implement").

**Downstream:**

- **Lane B** — change `DomainWiring.buses`'s type to `(infrastructure: TInfrastructure) => Partial<CQRSInfrastructure> | Promise<Partial<CQRSInfrastructure>>`, and at the resolution site (`domain.ts:473-474` today) fill in `commandBus: cqrsInfra.commandBus ?? new InMemoryCommandBus()`, same for `queryBus`/`eventBus`.
- **Lane D** (CLI templates, #136) and **Lane F** (docs, #138) — once Lane B merges, simplify the Kafka/NATS/RabbitMQ templates and adapter doc pages back down to emitting only the overridden bus. Not urgent: both lanes were already told to emit the full triple as an interim fix, which compiles under either option, so this is a cleanup, not a blocker.

## What 1.0 semver covers

Three independent compatibility surfaces, each with its own change cost — this section is the technical substance for issue #142's published compatibility policy.

1. **Public API (TypeScript types + runtime behavior of exported functions/classes)** — governed by normal semver. A breaking change here requires a major version bump. This is what all nine decisions above are about: freezing the _shape_ of `SagaPersistence`, `IdempotencyStore`, `EventBus`, `Instrumentation`, `CommandBus`/`QueryBus`, and `Snapshot`/`StateStoredAggregatePersistence` before 1.0 so post-GA changes to them are additive, not breaking.
2. **On-disk event/DDL format** — event payloads once persisted, state-stored/snapshot row shapes, and SQL schemas (Drizzle/Prisma/TypeORM). Changing this after GA is not a code change for users — it is a **data migration**. This is why decision 8 (schema-version envelope) matters even though it ships with zero behavioral change in 1.0: reserving the field now costs nothing; adding it after real data exists without a version marker costs an un-scriptable migration (there is nothing to key the upcast off of). Decision 2 (`SagaPersistence` version column) is in this bucket too — issue #132 calls it out explicitly as "cannot be fixed after GA without a breaking interface change."
3. **Broker wire format** — the bytes noddde puts on Kafka/NATS/RabbitMQ (currently unversioned raw `JSON.stringify(event)`, per #135). Changing this after GA breaks rolling/blue-green deployments where old and new service versions must interoperate on the same topic/queue during the deploy window. Decision 6 (late-`on()` contract) is API-surface, not wire-format — the wire-format versioning envelope itself is **not** decided by this lane (it's `#135`'s "Additional scope," owned by Lane C) and should be called out as a known gap in issue #142's policy rather than silently omitted.

Each decision above is tagged by which of these three surfaces it touches: (1) public API — decisions 1, 3, 4 (JSDoc only), 6 (JSDoc + error type), 7, 9; (2) on-disk format — decisions 2, 8; (3) broker wire format — decision 6's downstream adapter behavior only (the contract itself is public-API-level, since `on()` throwing is observable to any caller regardless of transport).

## Definition of Done

- [x] All nine decisions recorded in-repo with rationale and rejected alternatives (this document).
- [x] Core interface changes + in-memory implementations landed for decisions 2, 3, 5, 6, 7, 8 (decisions 1 and 9 are decide-only, zero core code by design — see each section).
- [x] `tsc --noEmit` green across `packages/core` and `packages/engine` (engine's `executors/`, `domain.ts`, `projection-rebuild.ts`, `outbox-relay.ts` are Lane B's and are expected to go red against the new `SagaPersistence`/`IdempotencyStore` shapes until Lane B rebases onto this — see "Known breakage for Lane B to absorb" below).
- [x] Every downstream lane's required follow-up is named explicitly per decision above (package, file, line, issue).
- [x] "What 1.0 semver covers" section above.

## Known breakage for Lane B to absorb (intentionally left red)

Per this lane's brief: "leaving core red for lanes to absorb is correct here... but leaving it undocumented is not." Compiling `packages/engine` against this lane's core changes will surface type errors at exactly these call sites, all inside Lane B's exclusive files:

- `packages/engine/src/executors/saga-executor.ts:76` (`sagaPersistence.load(...)` now returns `{state, version} | null`, not `any`) and `:230-232` (`sagaPersistence.save(...)` now requires a 4th `expectedVersion` argument).
- `packages/engine/src/executors/command-lifecycle-executor.ts:83-94,349-359` (`idempotencyStore.save(...)` can now throw `IdempotencyConflictError` — currently unhandled) and `:994,1015,1025,1045,1065` in `domain.ts` (`(commandBus as InMemoryCommandBus).register(...)` — still compiles as a cast, but should be replaced per decision 3's downstream note to get the fail-loud behavior).
- `packages/engine/src/domain.ts:53,397,451` and `packages/engine/src/executors/{metadata-enricher,saga-executor,command-lifecycle-executor}.ts` — all import `Instrumentation` from `./tracing` (or `../tracing`) and/or construct `new Instrumentation(otelApi)`. Decision 7 renames that concrete class to `OTelInstrumentation`; these five import sites will not compile until updated to `import { OTelInstrumentation } from "./tracing"` / `new OTelInstrumentation(otelApi)`. Mechanical rename, no behavior change needed. **This is a hard build blocker, not just a type error**: `domain.ts`'s `import { detectOTel, Instrumentation } from "./tracing"` fails at the esbuild/tsup bundling step (missing named export), so `yarn build` for `@noddde/engine` fails outright until this rename lands — verified locally (`tsup` errors with "No matching export in src/tracing.ts for import Instrumentation"). Apply this rename first, before anything else in this list, to get the package building again.
- No compile break from decisions 4, 6 (JSDoc-only / additive), but their _behavior_ is now specified and should be brought into compliance (causationId auto-generation, register() fail-loud).
