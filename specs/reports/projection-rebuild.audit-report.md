# Audit Report: Projection Rebuild API

- **Verdict**: PASS
- **Cycle**: 1
- **Auditor**: Claude Opus 4.7
- **Date**: 2026-05-19

This audit covers seven interconnected specs implemented as one logical change:

1. `specs/core/persistence/event-reader.spec.md` (NEW)
2. `specs/core/persistence/view-store.spec.md` (EDIT — added optional `truncate?()`)
3. `specs/core/persistence/adapter.spec.md` (EDIT — added optional `eventReader?`)
4. `specs/engine/implementations/in-memory-view-store.spec.md` (EDIT — added `truncate()`)
5. `specs/engine/implementations/in-memory-aggregate-persistence.spec.md` (EDIT — `InMemoryEventSourcedAggregatePersistence` also implements `EventReader`)
6. `specs/engine/projection-rebuild.spec.md` (NEW — main spec)
7. `specs/engine/domain.spec.md` (EDIT — added `TProjections` generic + `rebuildProjection<TName>(name, opts?)`)

---

## Mechanical Checks

| Check                    | Result                 | Details                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Export coverage          | PASS                   | `EventReader`, `EventReadOptions` exported from `@noddde/core/persistence`. `ProjectionRebuildOptions`, `ProjectionRebuildResult`, 5 typed error classes (`ProjectionNotFoundError`, `StrongConsistencyRebuildError`, `EventReaderUnavailableError`, `ViewStoreNotTruncatableError`, `MissingViewStoreFactoryError`), `rebuildProjectionImpl`, `RebuildContext` exported from `@noddde/engine` via `export * from "./projection-rebuild"`. |
| Stubs remaining          | PASS                   | `grep "throw new Error.*not implemented"` returns 0 hits in `packages/core/src/persistence/event-reader.ts` and `packages/engine/src/projection-rebuild.ts`. Every `throw` is purposeful (typed errors, viewId-derivation guard, `after`-cursor unsupported guard).                                                                                                                                                                        |
| Type check (core)        | PASS                   | `npx tsc --noEmit` clean in `packages/core`.                                                                                                                                                                                                                                                                                                                                                                                               |
| Type check (engine)      | PASS                   | `npx tsc --noEmit` clean in `packages/engine`.                                                                                                                                                                                                                                                                                                                                                                                             |
| Tests (core)             | PASS                   | 309/309 across 27 test files. Includes 7 new `event-reader.test.ts` describes and the `truncate?` and `eventReader?` type tests added to `view-store.test.ts` and `adapter.test.ts`.                                                                                                                                                                                                                                                       |
| Tests (engine)           | PASS                   | 366/366 across 35 test files. Includes the 13 new `projection-rebuild.test.ts` describes plus `truncate` and `read()` tests on the in-memory implementations.                                                                                                                                                                                                                                                                              |
| ESLint                   | PASS                   | `yarn lint` succeeds across all 14 lint targets with `--max-warnings 0`.                                                                                                                                                                                                                                                                                                                                                                   |
| Prettier (touched files) | PASS                   | All touched source files (`event-reader.ts`, `view-store.ts`, `adapter.ts`, `index.ts`, `projection-rebuild.ts`, `domain.ts`, `in-memory-view-store.ts`, `in-memory-aggregate-persistence.ts`, `ee-event-bus.ts`, all test files) match Prettier style. Pre-existing prettier issues in older spec files are not from this change.                                                                                                         |
| Samples still compile    | PASS                   | `yarn build` is clean across all 17 packages including `sample-auction`, `sample-flash-sale`, `sample-hotel-booking`. The 6th generic on `Domain` has a `= ProjectionMap` default so existing 5-generic `Domain<H, any, any, any, any>` call sites in `sample-hotel-booking/.../app.ts` continue to compile.                                                                                                                               |
| CLI template check       | PASS                   | `grep -rln "rebuild\|EventReader\|truncate" packages/cli/src/templates` returns no hits. No CLI template changes required — rebuild is a runtime method, not part of the aggregate/projection/saga definition pattern.                                                                                                                                                                                                                     |
| Invariants enforced      | PASS                   | Strong-consistency rejection thrown before any I/O (validated by `truncateCalled === false` assertion). `eventsRead >= eventsApplied >= viewsDeleted` enforced by the replay loop ordering. Subscriptions re-attached in a `finally` block. `durationMs >= 0` (computed before return).                                                                                                                                                    |
| Edge cases covered       | PASS-with-coverage-gap | All major scenarios in the spec are covered by tests (empty log, stale view truncation, `DeleteView` during replay, unhandled-event skip, strong-consistency rejection, missing EventReader, missing truncate, unknown name, subscription detach, subscription re-attach, `onProgress` progress ticks, type-level inference). See "Coverage Gap" note below.                                                                               |

### Behavioral Requirement Audit

All 27 behavioral requirements in `specs/engine/projection-rebuild.spec.md` are implemented, plus the new generic threading and Init step 10 registry recording in `specs/engine/domain.spec.md`. Spot-check of each requirement vs source line in `packages/engine/src/projection-rebuild.ts` and `packages/engine/src/domain.ts`:

- Requirement 1 (`Projection lookup` → `ProjectionNotFoundError`) — `domain.ts:1632-1635`.
- Requirement 2 (strong-consistency rejection BEFORE any I/O) — `domain.ts:1637-1639`, occurs prior to `getForContext`, `truncate`, `read()`, subscription detach. Test `truncateCalled === false` at `projection-rebuild.test.ts:509` confirms.
- Requirement 3 (`ViewStoreFactory` resolution → `MissingViewStoreFactoryError`) — `domain.ts:1641-1644`.
- Requirement 4 (base store via `factory.getForContext(undefined)`) — `domain.ts:1646`.
- Requirement 5 (EventReader resolution: adapter → structural fallback → `EventReaderUnavailableError`) — `domain.ts:1649-1669`. The structural fallback walks per-aggregate resolutions via `this._persistenceResolver.resolve(aggName)`. Because `GlobalAggregatePersistenceResolver.resolve(name)` returns the same global persistence regardless of name, this loop correctly handles both global and per-aggregate cases on the first iteration.
- Requirement 6 (truncate capability check → `ViewStoreNotTruncatableError`) — `domain.ts:1671-1673`.
- Requirement 7 (`progressInterval` validation → `RangeError`) — `domain.ts:1675-1683`.
- Requirements 8–14 (rebuild pipeline) — `projection-rebuild.ts:181-281`. The `try` opens at line 215 (right after detach); the `finally` re-attaches at lines 274-280 even on truncate/replay failure. The `await onProgress?.({ eventsApplied })` at line 252 is awaited.
- Requirement 11 (id extractor fallback to `event.metadata?.aggregateId`) — `projection-rebuild.ts:228-237`. Note: by the time we reach the helper, `domain.ts:911-929` has already defaulted every projection handler's missing `id` to the metadata fallback (with a clear error if neither exists), so the helper's fallback is defensive.
- Requirement 16-20 (failure-mode semantics) — `try/finally` block guarantees re-attach.
- Requirement 21 (registry shape) — `domain.ts:529-532` (typed registry), `domain.ts:1213-1219` (population in init step 10, only for eventual-consistency projections per the `continue` at line 1173).
- Requirement 22 (detach semantics + bus-without-off error) — `projection-rebuild.ts:200-213`. See "Coherence Observation #1" below.
- Requirement 23 (idempotent re-attach) — re-attach uses the same `eventBus.on(name, handler)` call. Domain `init` registers the handler once per `(projectionName, eventName)` pair.
- Requirements 24-27 (logging) — `projection-rebuild.ts:196` (start info), `:251` (progress debug), `:258-260` (completion info), `:270-272` (failure error).

### Domain init step 10 — subscription registry

The Build Report (and the spec) refer to this as "step 10" or "step 11" interchangeably; in the source it's the unnumbered loop after step 9 at `domain.ts:1168-1223`. The registry is populated only for eventual-consistency projections — strong-consistency projections are skipped at line 1173 (`continue`). This matches requirement 21 verbatim.

---

## Coherence Review

### Spec intent alignment — PASS

The implementation honors the spec's intent across all seven specs. Key observations:

1. **Validation precedes I/O.** Every typed error is thrown from `Domain.rebuildProjection` before `factory.getForContext(undefined)`, `viewStore.truncate()`, `eventReader.read()`, or any subscription touch. The strong-consistency test asserts `truncateCalled === false` after the throw, confirming the early-exit invariant at runtime as well as in code.

2. **Subscription re-attach is always reached.** The `try/finally` block in `rebuildProjectionImpl` opens immediately after detach and closes after the replay loop. On any throw inside the try (truncate failure, reader iteration failure, reducer exception, `onProgress` rejection), the `finally` re-attaches every handler that was detached. The `projSubs && busWithOff.off` guard at the re-attach site is the same predicate used at the detach site, so the two branches are symmetric.

3. **EventReader resolution order is correct.** Adapter `eventReader` is consulted first (line 1650); structural fallback on per-aggregate persistence is next (lines 1652-1664); `EventReaderUnavailableError` is the dead-end (line 1668). The loop correctly walks per-aggregate resolutions — and because `GlobalAggregatePersistenceResolver.resolve(name)` is name-agnostic, the same loop handles the global case in a single iteration. The implementation matches the spec's three-tier order.

4. **`TProjections` threading is backward-compatible.** The new 6th generic on `Domain` defaults to `ProjectionMap`. `InferDomain` and `wireDomain` both pass `ExtractProjections<TDef>` as the sixth argument. Existing 5-generic `Domain<...>` call sites (in `sample-hotel-booking/src/infrastructure/http/app.ts:18` and the nestjs and shutdown specs) compile unchanged via the default. The full `yarn build` succeeds across all 17 packages.

5. **Typed name inference works end-to-end.** The test at `projection-rebuild.test.ts:899-956` uses `@ts-expect-error` to confirm that `domain.rebuildProjection("Unknown")` is a compile-time error against a domain that only knows `"KnownProj"`. The directive is honored — if it were removed, the test would fail to compile, which means the generic threading is genuine.

6. **`id` extractor fallback honors the spec.** When `handler.id` is missing, the domain's init step 10 defaults it to a function that reads `event.metadata?.aggregateId` and throws a clear error if absent (lines 911-929). The rebuild helper has the same fallback as a defense-in-depth. The error message matches requirement 11's wording.

7. **`onProgress` is awaited.** Line 252: `await onProgress?.({ eventsApplied });`. A slow callback throttles the rebuild — exactly the spec's stated semantics.

### Coherence Observation #1 — `EventBus.off` placement (acceptable, not a FAIL)

The spec's requirement 22 reads:

> The `EventBus` interface (from `core/edd/event-bus`) MUST support removal — if the wired bus does not, `rebuildProjection` throws an error explaining the bus does not support detach.

The Builder added `off()` only to the concrete `EventEmitterEventBus` class (`ee-event-bus.ts:64-71`) — not to the `EventBus` interface in `core/edd/event-bus.ts:16-21`. `rebuildProjectionImpl` does a conditional cast at `projection-rebuild.ts:200-213` and throws an explanatory error when the wired bus lacks `off`. The Build Report flags this explicitly.

**Why this is not a FAIL:**

- The spec phrasing has two compatible readings. Reading A: "the interface must have an off method"; reading B: "the wired bus must support removal at runtime, otherwise the rebuild throws." The "if the wired bus does not" clause makes reading B coherent — it's a runtime check, not a structural-typing constraint.
- The end-state guarantee (caller gets a clear error when detach is impossible) is achieved either way.
- Adding `off?` to the `EventBus` interface would make this more architecturally honest, but it's a refinement, not a correctness issue. v1 ships with the conditional-cast approach.
- All five integration tests that exercise detach/re-attach (`projection-rebuild: subscriptions detach during replay`, `subscriptions re-attach after replay`, etc.) pass, which means the concrete `EventEmitterEventBus` path works end-to-end.

A future spec edit could promote `off?(name, handler)` to the `EventBus` interface as an optional method, which would make the conditional cast unnecessary. I am noting it here for the developer's awareness but not blocking the PASS.

### Unhandled scenarios — COVERAGE GAP (not a FAIL)

The spec lists two edge cases that the implementation handles but **no test exercises**:

- **Domain not yet initialized** — `rebuildProjection` called before `init()`. Handled at `domain.ts:1626-1630` (throws "Domain not initialized" with a clear message). Not tested.
- **Domain shutting down** — `rebuildProjection` called after `shutdown()`. Handled at `domain.ts:1623-1625` (throws `DomainShutdownError`). Not tested.

Both code paths are present and defensible from reading. The lack of tests is a coverage gap, not a behavior gap. Adding two short integration tests (one before `init()`, one after `shutdown()`) would close it. Since the implementation is correct and the gap is mechanical, I am not failing the cycle — but the developer should know.

### Convention compliance — PASS

- Functional style is preserved. The 5 error classes are infrastructure (acceptable per CLAUDE.md). `Domain` remains a class (existing infrastructure).
- JSDoc is present on every public export in `event-reader.ts`, `projection-rebuild.ts`, and the new methods on `domain.ts`.
- No `console.log/.warn/.error` in any of the new code. All logging routes through the `Logger` interface (`logger.info`, `logger.debug`, `logger.error`).
- Error class naming follows the project pattern: `ConcurrencyError`, `LockTimeoutError`, `DomainShutdownError` — and now `ProjectionNotFoundError`, `StrongConsistencyRebuildError`, `EventReaderUnavailableError`, `ViewStoreNotTruncatableError`, `MissingViewStoreFactoryError`. All have `override readonly name = "<ErrorName>" as const`.
- No backwards-compat shims, no dead code, no half-finished branches. The 6th generic with a `= ProjectionMap` default is genuine back-compat, not a shim — existing call sites pick up the default and compile unchanged.

### Breaking change propagation — PASS

The new generic is additive with a default. `grep -rln "Domain<" packages/samples/ specs/` finds existing 3- and 5-generic call sites and `Domain<any>` usages — all continue to compile via the default. The full `yarn build` succeeds. No downstream spec or sample needs updating.

The Builder did NOT add `off?` to the `EventBus` interface (see Coherence Observation #1), so the breaking-change surface for interface consumers is zero.

---

## Documentation

I completed Phase B (docs) myself. Cycle-1 PASS, no need for the Builder to redo anything.

**Pages created (1):**

- `docs/content/docs/read-model/projection-rebuild.mdx` — Full user-facing guide covering: when to rebuild, the `domain.rebuildProjection` API surface with options/result, the rebuild pipeline (validate → detach → truncate → replay → re-attach), the "halt writes" caveat (explicit, not soft-pedaled), the strong-consistency rejection, the five typed errors with catch examples, the EventReader resolution order, a worked banking-domain example, and an adapter-author section covering `ViewStore.truncate()` and `EventReader` implementation. The "halt writes" section names shadow-rebuild as the v1 workaround for systems that cannot stop writes.

**Pages updated (4):**

- `docs/content/docs/read-model/meta.json` — added `projection-rebuild` to the page list.
- `docs/content/docs/read-model/projections.mdx` — added a "Rebuilding a Projection" section linking to the new page, and a Next Steps entry.
- `docs/ARCHITECTURE.md` — moved "projection rebuild" from the remaining-gaps list to a "complete" bullet describing the shipped capability.
- `ROADMAP.md` — checked the **Projection Rebuild API** item and rewrote the bullet to describe the actual shipped surface.
- `docs/public/llms.txt` — added a Read Model section entry for `projection-rebuild`.

**API reference**: `docs/src/content/docs/api/` is TypeDoc-auto-generated. The new classes and types will appear on the next regeneration; no manual changes needed.

**Prettier**: All 5 touched/created doc files match Prettier style.

---

## Calibration Notes

This is a cycle-1 audit. The implementation faithfully reflects all seven specs, all 675 tests pass, type-checks are clean, lint is clean, and the docs are now in place. The two findings I considered (the `EventBus.off` placement and the missing init/shutdown guard tests) are observations rather than spec violations — they do not block ship.

Per the calibration rules:

> 1. FAIL must be tied to spec violations. Style preferences are not grounds for FAIL.
> 2. Findings must be actionable. Every finding has a Location and a Fix.
> 3. Documentation issues you can fix yourself: fix them and PASS.
> 4. Pragmatism over perfection — a 95% coherent implementation that ships beats a 100% perfect one in review limbo.

This implementation is well above 95% coherent. Verdict: **PASS**.

---

## Suggested Follow-ups (non-blocking)

1. **Promote `EventBus.off` to an optional interface method.** Add `off?(name: string, handler: AsyncEventHandler): void` to the `EventBus` interface in `core/edd/event-bus.ts`. Remove the `as EventBus & { off?: ... }` cast in `projection-rebuild.ts`. This makes the architectural intent explicit and lets future bus adapters discover the requirement statically.
2. **Add init/shutdown guard tests.** Two short `it` blocks in `projection-rebuild.test.ts`: one calls `rebuildProjection` on a freshly-constructed-but-not-initialized `Domain` (expect "Domain not initialized"), one calls it after `await domain.shutdown()` (expect `DomainShutdownError`).
3. **CLI command `noddde rebuild projection <name>`.** The spec mentions this as a future enhancement. Worth tracking; not blocking v1.

None of these affect the audit verdict.
