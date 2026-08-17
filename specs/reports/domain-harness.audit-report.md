# Audit Report: testDomain command-dispatch spy — scoped error swallowing

- **Verdict**: PASS
- **Cycle**: 1
- **Auditor**: Claude Opus 5
- **Date**: 2026-08-17
- **Spec**: `specs/testing/domain-harness.spec.md`

## Mechanical Checks

| Check                                        | Result | Details                                                                                                                                                                            |
| -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export coverage                              | PASS   | `testDomain`, `TestDomainConfig`, `TestDomainResult` exported from `domain-harness.ts`; `DomainSpy` from `types.ts`. All four re-exported.                                         |
| Requirement 1                                | PASS   | `recordDispatch` pushes to `dispatchedCommands` before the `try`. Implemented + tested (all 4 tests).                                                                              |
| Requirement 2                                | PASS   | `isMissingHandlerError` → `unhandledCommands.push` + `return undefined as T`. Implemented + tested (tests 1, 3).                                                                   |
| Requirement 3a/3b                            | PASS   | `commandErrors.push({command, error})` then bare `throw error` — same identity, not wrapped. Implemented + tested (test 2).                                                        |
| Requirement 4                                | PASS   | Implemented + tested (test 4).                                                                                                                                                     |
| Requirement 5                                | PASS   | Strict `===` against the interpolated per-command message, not a prefix/substring match. Implemented, not directly tested (accepted — see below).                                  |
| Invariant: push-before-try                   | PASS   | Structurally guaranteed by `recordDispatch`.                                                                                                                                       |
| Invariant: mutual exclusion                  | PASS   | Single `if/else` in one `catch` — a dispatch can reach only one array.                                                                                                             |
| Invariant: dispatch count                    | PASS   | Holds once both spied entry points are counted; spec Invariant 1 wording was stale and has been corrected (see Documentation).                                                     |
| Edge case: resembling message, other command | PASS   | Exact equality against `command.name` cannot match another command's name.                                                                                                         |
| Edge case: non-`Error` throw                 | PASS   | `error instanceof Error` guard fails → falls through to `commandErrors` + rethrow.                                                                                                 |
| Edge case: self-shaped throw                 | PASS   | Suppressed, exactly as the spec declares an accepted limitation.                                                                                                                   |
| Edge case: saga reaction                     | PASS   | Verified: `saga-executor.ts:193` dispatches via `infrastructure.commandBus.dispatch` → the spied bus. Tested (test 3).                                                             |
| Stub check                                   | PASS   | No stub throws; the only `throw` is the deliberate rethrow.                                                                                                                        |
| Type check                                   | PASS   | `packages/testing` `tsc --noEmit` clean.                                                                                                                                           |
| Test execution                               | PASS   | Whole-package `vitest run`: 5 files, 45 tests, all GREEN. No regressions.                                                                                                          |
| Pre-existing test untouched                  | PASS   | `git diff HEAD -- packages/testing/src/__tests__/domain-harness.test.ts` empty; its 10 tests still pass.                                                                           |
| Blast radius                                 | PASS   | Nothing under `packages/core/src`, `packages/engine/src`, `packages/cli/src`, or `samples/*/src` modified. Other `git status` entries belong to the concurrent CI/lint workstream. |
| CLI templates                                | N/A    | No aggregate/projection/saga scaffold shapes affected.                                                                                                                             |
| Prettier                                     | PASS   | All touched files pass `--check` (spec file reformatted by `--write`).                                                                                                             |

## Coherence Review

- **Spec intent alignment**: The implementation does what the spec means, not merely what its tests check. The one error class the harness exists to suppress is suppressed and recorded; everything else is recorded _and_ rethrown with original identity. The Builder's claim about `Domain.dispatchCommand` was verified independently against `packages/engine/src/domain.ts:1454-1470`: the routing loop tests `command.name in aggregate.decide` and calls `_commandExecutor.execute` directly, returning before ever reaching `commandBus.dispatch` at line 1470. Without the second wrapper, spec Test Scenarios 2 and 4 are unsatisfiable, so the wrapper is necessary, not gold-plating.
- **Gating correctness (no double-count, no dropped case)**: The harness derives `aggregateCommandNames` from `Object.keys(aggregate.decide)` over `config.aggregates`, which is precisely the map the engine passes as `definition.writeModel.aggregates` and iterates in the routing loop. Fast path and bus path are therefore complements, and each dispatch is recorded exactly once. A name declared by two aggregates is still one dispatch (the engine `return`s on first match) and still one record. Verified there is no path where `dispatchCommand` takes the fast path _and_ the bus path.
- **Cast safety**: `(domain as { dispatchCommand: unknown }).dispatchCommand = ...` writes an own property that shadows the prototype method. Callers still see the class's full generic signature (the `domain` binding keeps its `Domain<...>` type), and the wrapper returns the original call's resolved value, so `targetAggregateId` propagation is preserved. `_acquireOperation`/instrumentation/UoW behavior is untouched because the original bound method still runs.
- **Unhandled scenarios** (all minor, none spec-violating, none worth blocking on):
  1. The engine routes with `in`, the harness gates with `Object.keys`. A command named after an `Object.prototype` member (`toString`, `constructor`) would satisfy the engine's `in` check but miss the harness's `Set` — an unrecorded dispatch rather than a double-count. Such a command already breaks in the engine independently of this change; not worth guarding.
  2. When suppression triggers on the `dispatchCommand` path, `recordDispatch` returns `undefined` where the signature promises `targetAggregateId`. Reachable only via the accepted self-shaped-message edge case.
  3. A dispatch after `domain.shutdown()` now lands in `commandErrors` (as `DomainShutdownError`) before rethrowing. Benign and arguably an improvement in visibility.
- **Convention compliance**: Functional style, no classes, no `console.*`, JSDoc present on the new helper and both new `DomainSpy` fields. One nit: the JSDoc on `testDomain` is separated from the function by the `isMissingHandlerError` block, so the doc comment no longer binds to `testDomain` for tooling purposes. Cosmetic; not blocking.
- **Breaking change propagation**: N/A — purely additive to `DomainSpy`; existing fields and the `testDomain` signature are unchanged, so no consumer breaks.

## Documentation

- **Pages updated**: 2 (one docs page, one spec)
  - `docs/content/docs/testing/testing-domains.mdx` — the "Result Shape" block presented the full `DomainSpy` type with only two fields and was actively wrong after this change; added `unhandledCommands`/`commandErrors`. Extended the dispatched-commands note with an `unhandledCommands` assertion and added a "Spy: Command Errors" section covering scoped swallowing and the saga-reaction caveat, matching the page's existing tone.
  - `specs/testing/domain-harness.spec.md` — Invariant 1 asserted `dispatchedCommands.length === commandBus.dispatch` call count, which the spec's own Integration Points paragraph (and Test Scenarios 2 and 4) contradict. Reworded to count both spied entry points.
- **Pages created**: 0 — no new public-facing feature; nothing speculative added.
- `docs/public/llms.txt` untouched (no page added, removed, or renamed).

## Findings

None blocking. The three minor items under "Unhandled scenarios" are recorded for future reference only.
