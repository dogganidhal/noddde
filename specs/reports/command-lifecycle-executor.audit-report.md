## Audit Report: UoW Completion Hooks bundle (CommandLifecycleExecutor, SagaExecutor, Domain, Domain Shutdown)

> **Why one report for four specs**: the Builder produced a single implementation covering
> `specs/engine/executors/command-lifecycle-executor.spec.md`, `specs/engine/executors/saga-executor.spec.md`,
> `specs/engine/domain.spec.md` and `specs/engine/domain-shutdown.spec.md` (Build Report:
> `specs/reports/uow-completion-hooks.build-report.md`). The four sets of requirements share one mechanism
> (`packages/engine/src/uow-completion-hooks.ts`), so splitting the review into four reports would have
> duplicated the same coherence analysis four times. This deviates from the one-report-per-spec convention
> deliberately; per-spec verdicts are given below.

- **Verdict**: FAIL (bundle) — per-spec: CommandLifecycleExecutor PASS, SagaExecutor PASS, Domain Shutdown PASS, **Domain FAIL**
- **Cycle**: 1

### Per-Spec Verdicts

| Spec                                                        | Requirements audited                                                                                                                | Verdict | `status` set to     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------- |
| `specs/engine/executors/command-lifecycle-executor.spec.md` | 12, 12a, 14a (+ 2 new Test Scenarios)                                                                                               | PASS    | `implemented`       |
| `specs/engine/executors/saga-executor.spec.md`              | 13, 14, 15 (+ 1 new Test Scenario)                                                                                                  | PASS    | `implemented`       |
| `specs/engine/domain-shutdown.spec.md`                      | 13 (+ 1 new Test Scenario)                                                                                                          | PASS    | `implemented`       |
| `specs/engine/domain.spec.md`                               | "Event Publishing Runs Outside the UoW's ALS Scope" 1-3, "Fail Loud on Unwired Projection View Stores" 1-3 (+ 3 new Test Scenarios) | FAIL    | left `implementing` |

### Mechanical Checks

| Check               | Result     | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export coverage     | PASS       | `uow-completion-hooks.ts` exports `onUowCommitted` / `onUowSettled` / `runUowCompletionHooks`; engine-internal (not re-exported from `@noddde/engine`), as specified in req 14a                                                                                                                                                                                                                                                                                                                                                           |
| Stubs remaining     | PASS       | 0 — `grep "throw new Error"` on the 5 touched sources shows only intentional throws (missing decide handler, nested-UoW guard, wiring validation, the new fail-loud init error at `domain.ts:852`, `OptimisticConcurrencyStrategy`'s unreachable guard)                                                                                                                                                                                                                                                                                   |
| Type check          | PASS       | `cd packages/engine && npx tsc --noEmit` clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tests               | PASS       | `npx vitest run` in `packages/engine`: 40 files / **405 passing**, 0 failures — the Build Report's claim reproduced independently                                                                                                                                                                                                                                                                                                                                                                                                         |
| ESLint              | PASS       | `npx eslint src --max-warnings 0` clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Prettier            | FAIL→fixed | `prettier --check` was **not** clean, contrary to the Build Report: `specs/engine/domain.spec.md`, `.../command-lifecycle-executor.spec.md`, `.../saga-executor.spec.md` and `specs/reports/uow-completion-hooks.build-report.md` all failed. Repo CI runs `yarn format:check` over `**/*.{ts,tsx,md}` with no `.prettierignore`, so this would have broken CI. Formatted by the Auditor (cosmetic only: emphasis markers, wrapping, table padding; `__tests__` paths in the report backticked so prettier stops rewriting them to bold). |
| Invariants enforced | PARTIAL    | See Finding 1 — the CommandLifecycleExecutor invariant "a pessimistic lock ... is released exactly once, when the owning UoW settles" is honored by the executor and by `SagaExecutor`, but `Domain.withUnitOfWork` releases it _after_ its publish loop                                                                                                                                                                                                                                                                                  |
| Edge cases covered  | PASS       | Both new CLE edge cases (lock held to settlement; deferred snapshot on commit **and** skipped on rollback) have dedicated tests; both new domain-shutdown edge cases (drain wins / timeout wins) are covered by the new timer test plus the pre-existing timeout tests                                                                                                                                                                                                                                                                    |
| Scope containment   | PASS       | No changes under `packages/core/**` or `packages/engine/src/implementations/**`. `projection-rebuild.ts` and `outbox-relay.ts` are modified in the worktree but by **earlier** builds this session (upcaster wiring during rebuild; relay poll error logging) — verified by reading those diffs; neither references `uow-completion-hooks`                                                                                                                                                                                                |

### Coherence Review

**Requirement 12 / 12a (lock held across the owning commit) — faithful.**
`ConcurrencyStrategy.acquireForUow` is optional on the interface; `PessimisticConcurrencyStrategy` acquires
and registers the release via `onUowSettled` (no `finally`, no retry); `PerAggregateConcurrencyStrategy`
always defines it and delegates only when the resolved strategy has one; `OptimisticConcurrencyStrategy`
does not define it. The executor's explicit-UoW branch calls `acquireForUow` when present and otherwise
falls through to the **byte-identical** pre-existing `concurrencyStrategy.execute(... return [])` wrap, so
pure-optimistic aggregates in an explicit UoW behave exactly as before (verified against the diff). The
lock is genuinely held past `runLifecycle`'s return: the new test proves a second `execute()` on the same
aggregate rejects with "already locked" while the owning UoW is still open, and the release only fires on
`runUowCompletionHooks`.

**Requirement 14a (hook registry) — faithful, and safe against double-invocation.** `runUowCompletionHooks`
deletes the registration _before_ running hooks, so a second call is a no-op; `onCommitted` runs only when
`committed`, then `onSettled` always. `WeakMap` keying means an unhooked UoW costs one lookup.

**Snapshot deferral — verified both directions.** Registered via `onUowCommitted`, never saved inline in the
explicit path; the rollback test asserts the store is still `null` after `runUowCompletionHooks(uow, false)`,
so it is a real conditional, not "save if committed" with an untested else branch. Save errors are still
swallowed inside the hook, preserving the best-effort invariant.

**Exactly-once hook invocation on every exit path — verified.** `SagaExecutor` guards with a `hooksRan`
flag, calls `runHooksOnce()` after the ALS scope settles and again in an outer `finally` that covers the
`failCommitPhase` rethrow, and catches/logs hook errors so a hook failure cannot block publishing.
`Domain.withUnitOfWork` wraps everything in an outer `finally`, so hooks also run when `fn()` throws, when
`commit()` throws part-way, and when a subscriber in the publish loop throws. No lock-leak path found in
either owner.

**Publish moved outside the ALS scope — verified by tracing, not by summary.** In `withUnitOfWork` the
`uowStorage.run(...)` callback now returns `{ result, events }` and only `fn()` + `commit()`/`rollback()`
run inside it; the dispatch loop and `markPublishedByEventIds` are after it. In `SagaExecutor`, `commitOnly`
runs inside the scope and `publish(events)` outside, in both atomic and best-effort modes, with `committed`
correctly `false` whenever `failCommitPhase` was reached.

**Fail-loud init — correct, with no false positive.** The check iterates `resolvedProjections`, skipping any
name present in `resolvedViewStoreFactories`; an empty `resolvedProjections` iterates zero times, so a domain
with no projections cannot trip it. It sits at step 5.7b, before outbox resolution (5.8b), before command
handler registration (step 7, `domain.ts:1040`) and before projection event-bus subscription (`domain.ts:1102`),
so a broken domain never accepts traffic. The warning uses `domainLog` (a child of the **configured** logger),
proven by the new test injecting a custom `Logger` and asserting the captured `warn` message; the existing
suite also shows the warning firing for a pre-existing eventual projection without breaking anything.

**Shutdown timers — correct.** Both `setTimeout` handles are captured and `clearTimeout`'d immediately after
their `Promise.race` settles, in both drain phases; race semantics are untouched.

**Convention compliance**: compliant. No `console.*`; the new module and the new interface method carry
JSDoc; classes only for infrastructure (allowed); no new public API surface.

**Unhandled scenario (the FAIL)**: pessimistic concurrency combined with `withUnitOfWork` and any re-entrant
same-aggregate dispatch — see Finding 1. Also worth noting for the Builder: the new CLE tests call
`runUowCompletionHooks` _manually_ to simulate an owner, which is exactly why the real owner's ordering bug
was not caught by the suite.

**Breaking change propagation**: N/A — internal reliability fixes; `acquireForUow` is optional on an
`@internal` interface, so no downstream spec or sample needs updating.

### Documentation

- **Pages updated**: 2
  - `docs/content/docs/running/persistence.mdx` — the line "Pessimistic locking still acquires/releases per command within the UoW" documented the exact defect this build fixes; rewritten to state the lock is held until the owning UoW settles, and that a second command queues (or times out per `lockTimeoutMs`) until then.
  - `docs/content/docs/read-model/view-persistence.mdx` — Validation list said `consistency: "strong"` without `viewStore` is "silently ignored -- treated as eventual"; now documents the init-time throw, plus the new `warn` for an unwired eventual projection.
- **Pages created**: 0
- **API reference updated**: 0 (no public API changed; graceful-shutdown docs make no claim about timer handles, so nothing there was stale)

### Findings

1. **[MECHANICAL] `Domain.withUnitOfWork` runs `runUowCompletionHooks` _after_ the publish loop, so a pessimistic lock is still held while events are dispatched — a re-entrant same-aggregate dispatch deadlocks the process.**

   - **Location**: `packages/engine/src/domain.ts:1341-1389` (the `try { … } finally { await runUowCompletionHooks(uow, committed); }` around the publish loop)
   - **Evidence**: reproduced with a throwaway test (since deleted): domain with pessimistic concurrency +
     `InMemoryAggregateLocker`, one aggregate, a standalone event handler that dispatches `Increment` on the
     **same** aggregate in reaction to `CounterCreated`, and a `withUnitOfWork` that dispatches
     `CreateCounter`. `withUnitOfWork` never resolves — the test times out at 3000 ms. Chain: `acquireForUow`
     holds the lock → commit → publish loop → standalone handler dispatches → no ambient UoW → implicit path →
     `PessimisticConcurrencyStrategy.execute` → `locker.acquire` queues FIFO behind the still-held lock
     (`in-memory-aggregate-locker.ts:51-78`; no timeout by default = waits forever) → the publish loop never
     returns → the `finally` that would release the lock is never reached. With `lockTimeoutMs` set it becomes
     a `LockTimeoutError` swallowed into a log by the event bus, i.e. the same silent-command-loss class of bug
     this build set out to fix. This is a **regression**: before the change the explicit-UoW path released the
     lock in `PessimisticConcurrencyStrategy.execute`'s `finally` when the lifecycle returned, so no deadlock
     was possible.
   - **Fix**: mirror `SagaExecutor` exactly — add a `hooksRan`-guarded `runHooksOnce()` helper, `await` it
     immediately after `uowStorage.run(...)` returns and **before** the dispatch loop, keep the outer `finally`
     calling the same guarded helper (so throw paths still fire it exactly once), and catch + log hook errors
     via `this._infrastructure.logger` so a failing hook cannot block publishing. Verified by the Auditor: with
     that change the repro passes and the full engine suite stays green (406/406 including the repro).
   - **Spec follow-up (Orchestrator)**: `specs/engine/domain.spec.md`, section "Event Publishing Runs Outside
     the UoW's AsyncLocalStorage Scope", item 3 currently only says hooks run "exactly once, after settlement,
     outside the ALS scope" — the implementation satisfies that literally. Tighten it to require hooks **before**
     the publish loop (matching `saga-executor.spec.md` requirement 13, which already states "a slow publish
     cannot delay lock release"), and add a Test Scenario for pessimistic concurrency + `withUnitOfWork` +
     re-entrant same-aggregate dispatch from a standalone handler, asserting both events land. Without that
     scenario the suite has no guard against this regression returning.

### Non-blocking notes (pre-existing, not caused by this build)

- `specs/engine/executors/command-lifecycle-executor.spec.md` requirement 4, its Edge Case entry, and its
  "throws when no decide handler is found" Test Scenario all say `"No decide handler found for command: …"`,
  while `command-lifecycle-executor.ts:324` and the generated test assert `"No command handler found for
command: …"`. Pre-dates this build; behaviour is user-visible, so pick a side in its own spec pass rather
  than as a drive-by.
- The same spec's Type Contract still shows `snapshotStore?/snapshotStrategy?` constructor parameters and a
  bare `persistence` first argument, while the code takes an `AggregatePersistenceResolver` plus a
  `snapshotResolver` (and `logger`/`instrumentation`). The **new** Test Scenarios use the current signature
  correctly; only the older scenarios and the Type Contract block are stale. Code wins for type-level details
  per CLAUDE.md, so the spec block should be refreshed.
- `specs/engine/projection-rebuild.spec.md` and the two outbox-relay reports in `specs/reports/` also fail
  `prettier --check`; they belong to other builds in this session and were left untouched, but `yarn format:check`
  will stay red until they are formatted too.

---

## Cycle 2

**Spec**: `specs/engine/domain.spec.md` (the only spec re-opened by cycle 1)
**Verdict**: **PASS**
**Spec status**: `implementing` -> `implemented`

### Scope

Cycle 1 FAILed `domain.spec.md` only: `Domain.withUnitOfWork` ran
`runUowCompletionHooks` AFTER the publish loop, so a deferred pessimistic-lock
release stayed pending while events were published, and a same-aggregate
re-entrant dispatch from a standalone handler deadlocked (or silently lost the
command to a swallowed `LockTimeoutError`). The spec was then corrected to
mandate hooks-BEFORE-publish (section "Event Publishing Runs Outside the UoW's
AsyncLocalStorage Scope", item 3) plus a regression Test Scenario. This cycle
audits that fix. The other three cycle-1 specs
(`command-lifecycle-executor.spec.md`, `saga-executor.spec.md`,
`domain-shutdown.spec.md`) were already `implemented` and are re-confirmed only
through the full-suite run below.

### Implementation review — `packages/engine/src/domain.ts:1336-1417`

Read directly from the file, not from the Build Report.

- **Ordering**: `await runHooksOnce()` sits at line 1382, immediately after
  `this._uowStorage.run(...)` returns and **before** the `for (const e of
events) await eventBus.dispatch(e)` loop (1389-1391) and before the
  outbox `markPublishedByEventIds` block (1394-1405). Matches spec item 3 and
  mirrors `saga-executor.ts:250` / `:276`.
- **Hooks run outside the ALS scope**: both call sites are outside the
  `_uowStorage.run` callback, so a hook can never observe the completed `uow`
  as the ambient store.

### Exactly-once — independently traced

`runHooksOnce` sets `hooksRan = true` **synchronously, before its first
`await`**, so any later call is a guaranteed no-op regardless of interleaving.
The three exit paths:

1. **Success (commit + publish)** — `_uowStorage.run` resolves with
   `{ result, events }`; line 1382 runs the hooks with `committed === true`
   (set at 1370 inside the scope). The outer `finally` (1412) then calls
   `runHooksOnce` again, which returns at the `hooksRan` guard. **Once.**
2. **`fn()` throws** — the inner `catch` (1372-1379) attempts
   `uow.rollback()` and rethrows; the `await` at 1366 rejects, so line 1382 is
   never reached; control goes straight to the `finally` at 1408, which runs
   the hooks with `committed === false` (so only `onUowSettled` hooks — the
   lock release — fire, not `onUowCommitted` snapshot saves). **Once.**
3. **`commit()` throws** — identical to (2): `committed` is never set, the
   rollback is attempted, the rejection skips 1382, the `finally` fires the
   hooks with `committed === false`. **Once.**

Two additional paths checked: a rejection _inside the publish loop_ or the
outbox block still leaves `hooksRan === true` from 1382, so the `finally` is a
no-op — no double-run. And the two pre-`uow` throws (nested-UoW guard at 1340,
`_unitOfWorkFactory()` itself) happen before the inner `try`, where no UoW and
therefore no hooks exist — nothing to leak.

**No path exists where neither call fires**: 1382 and 1412 are in the same
`try`/`finally`, and the `finally` is unconditional. **No path fires twice**:
the guard flips before any suspension point. Defence in depth:
`runUowCompletionHooks` itself does `registry.delete(uow)` before invoking
hooks (`uow-completion-hooks.ts:46`), so even a hypothetical second entry would
find an empty registration. Only three call sites exist repo-wide
(`domain.ts:1357`, `saga-executor.ts:216`, and nothing else), each owning a
distinct UoW — no cross-owner double-run.

**Hook failure isolation**: `runUowCompletionHooks` is wrapped in
`try/catch` inside `runHooksOnce`, logging via
`this._infrastructure.logger.error("UoW completion hooks failed.", …)` (no
`console.*`, per CLAUDE.md). So a throwing hook cannot abort the publish loop
for already-committed events, and cannot replace a real `fn()`/`commit()` error
propagating out of the `finally`.

### Regression test review — `packages/engine/src/__tests__/engine/domain.test.ts:2565-2636`

Exercises exactly the cycle-1 scenario: `strategy: "pessimistic"` with
`InMemoryAggregateLocker` and `lockTimeoutMs: 500`, a `withUnitOfWork` that
dispatches `Bump{by:1}` at `Counter:c-1`, and a **standalone** `Bumped` handler
that re-dispatches `Bump{by:100}` at the **same** aggregate id (guarded by
`by === 1` so it cannot recurse). Asserts two persisted events with
`events[1].payload === { by: 100 }`.

RED verified independently, not taken on trust: the Auditor temporarily
restored the pre-cycle-2 ordering (removed the 1382 call, leaving only the
`finally`) and ran the test in isolation — it failed in 531 ms with
`AssertionError: expected [ … ] to have a length of 2 but got 1`, preceded by
the exact swallowed
`LockTimeoutError: Lock acquisition timed out for Counter:c-1 after 500ms`
logged by `ee-event-bus`. `domain.ts` was then restored byte-for-byte and the
file re-run green (51/51). The mechanics are sound in both directions: the
failure is a real deadlock, so no lock timeout is "generous enough" to let it
pass, and the assertion — not a vitest timeout — is what fails, so the test is
not sensitive to machine speed. With the fix the lock is already free, so the
test needs no waiting at all (whole suite runs in ~1 s).

### Checks re-run by the Auditor

| Check  | Command                                             | Result                                           |
| ------ | --------------------------------------------------- | ------------------------------------------------ |
| Types  | `packages/engine` `npx tsc --noEmit`                | clean, exit 0                                    |
| Tests  | `packages/engine` `npx vitest run`                  | **406 passed / 406**, 40 files, exit 0           |
| Lint   | `packages/engine` `npx eslint src --max-warnings 0` | clean, exit 0, zero output                       |
| Format | repo root `npx prettier --check "**/*.{ts,tsx,md}"` | **"All matched files use Prettier code style!"** |

Cycle 1's biggest miss (unclean `prettier --check`, including the
`projection-rebuild.spec.md` and outbox-relay reports called out in the
non-blocking notes above) is now resolved repo-wide, not just in the files
cycle 2 touched. `yarn format:check` uses this exact glob, so CI formatting is
green. (`npx prettier --check` widened to include `json` flags three
pre-existing `tsconfig.json` files — `packages/cli`, `packages/integrations/nestjs`,
`samples/sample-hotel-booking` — which are outside CI's glob and untouched by
this work. Not a finding.)

### Blast radius

`git status` / `git diff --stat` plus file mtimes confirm cycle 2 touched only
four files (all at 23:30-23:35): `specs/engine/domain.spec.md`,
`packages/engine/src/__tests__/engine/domain.test.ts`,
`packages/engine/src/domain.ts`, and its Build Report. No changes in
`packages/core/**` (clean in `git status`), none in
`packages/engine/src/implementations/**`, and `projection-rebuild.ts` /
`outbox-relay.ts` carry only their earlier-cycle edits (mtimes 22:57 / 23:03,
predating cycle 2).

### Cross-spec coherence

The three other cycle-1 specs remain consistent. Their test files are part of
the 406-test run and none regressed. Spot-checked the boundary the change sits
on: only `CommandLifecycleExecutor`'s **explicit**-UoW branch defers work via
`onUowCommitted`/`acquireForUow` (`command-lifecycle-executor.ts:183-217`) —
the implicit path still releases its lock inside
`concurrencyStrategy.execute`, so it never depended on hook timing and is
unaffected. `SagaExecutor` already owned its own identical `runHooksOnce`
closure; `withUnitOfWork` now matches it rather than diverging.

### Nit (not blocking, pre-existing pattern)

`runHooksOnce`'s `catch` block calls `logger.error(...)` unguarded. A
user-supplied `Logger` whose `error()` throws would make `runHooksOnce` reject
— skipping publish on the success path, or masking the original `fn()` error
from the `finally` on a failure path. `NodddeLogger` never throws, and
`SagaExecutor` has the same shape, so this is a pre-existing framework-wide
assumption ("`Logger` implementations must not throw") rather than something
introduced here. Worth one line in the `Logger` spec at some point; not worth a
cycle.
