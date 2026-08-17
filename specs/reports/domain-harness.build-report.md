# Build Report: testDomain command-dispatch spy — scoped error swallowing

**Date**: 2026-08-17
**Builder**: Claude Sonnet 5
**Spec**: `specs/testing/domain-harness.spec.md`
**Status**: GREEN
**Loop count**: 1 (no rework needed — RED confirmed, then implementation went GREEN on first pass)

---

## Summary

`testDomain`'s `commandBus.dispatch` wrapper previously swallowed **every** error from the underlying `InMemoryCommandBus.dispatch`, unconditionally. It now only suppresses the exact "no handler registered for this command" case (matched against the dispatched command's own name), recording that on `spy.unhandledCommands`; every other thrown error is recorded on `spy.commandErrors` as `{ command, error }` and rethrown unchanged.

A gap not spelled out in the Behavioral Requirements text but required by the given Test Scenarios: `Domain.dispatchCommand` (from `@noddde/engine`) routes commands that match a registered aggregate's `decide` handler **directly** to the command executor, bypassing `commandBus.dispatch` entirely. This was confirmed empirically during the RED run — `spy.dispatchedCommands` stayed at length 0 after calling `domain.dispatchCommand(...)` with an aggregate-routed command, even though the wrapper unconditionally pushes to `dispatchedCommands` before its try/catch. Since `packages/engine/src` cannot be modified, `domain.dispatchCommand` is now also wrapped, but only for command names present in the configured aggregates' `decide` maps — commands that fall through to the (already-spied) `commandBus.dispatch` are left untouched to avoid double-counting.

---

## Files Changed

### Modified Files

- `packages/testing/src/types.ts` — added `unhandledCommands: Command[]` and `commandErrors: Array<{ command: Command; error: Error }>` fields to `DomainSpy`, with JSDoc matching the spec's Type Contract. Existing `publishedEvents`/`dispatchedCommands` fields unchanged.
- `packages/testing/src/domain-harness.ts` — added `isMissingHandlerError(error, commandName)` helper (exact-match against `` `No handler registered for command: ${commandName}` ``, scoped to the dispatched command's own name) and a shared `recordDispatch(command, dispatch)` closure implementing the push/try/catch/partition-into-unhandled-or-errors logic. Applied it to `commandBus.dispatch` (replacing the old unconditional swallow) and, additionally, to `domain.dispatchCommand` scoped to aggregate-routed command names only.

### New Files

- `packages/testing/src/__tests__/domain-harness-spy.test.ts` — 4 tests, one per spec Test Scenario heading, assembled from the spec's ready-to-use code blocks unmodified.

---

## Step 2: RED Tests

All 4 new tests failed against the pre-existing implementation, confirming RED:

| Test                                    | Failure                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| unhandled command suppressed            | `spy.unhandledCommands` was `undefined` (field didn't exist)                                                                           |
| business-rule error rethrown + recorded | `spy.dispatchedCommands` had length 0 (aggregate-routed `domain.dispatchCommand` call never reached the wrapped `commandBus.dispatch`) |
| saga reaction error recorded            | `spy.unhandledCommands` was `undefined`                                                                                                |
| success path not mis-recorded           | `spy.dispatchedCommands` had length 0 (same aggregate-routing bypass)                                                                  |

---

## Step 3: Implementation

Key snippet from `packages/testing/src/domain-harness.ts`:

```ts
function isMissingHandlerError(
  error: unknown,
  commandName: string,
): error is Error {
  return (
    error instanceof Error &&
    error.message === `No handler registered for command: ${commandName}`
  );
}
```

`recordDispatch` is shared between the `commandBus.dispatch` override and the `domain.dispatchCommand` override (the latter gated by `aggregateCommandNames.has(command.name)`, derived from `Object.keys(aggregate.decide)` across `config.aggregates`), so no dispatch is ever double-counted between the two entry points.

---

## Step 4: Test Results

```
cd packages/testing && npx vitest run src/__tests__/domain-harness-spy.test.ts src/__tests__/domain-harness.test.ts
Test Files  2 passed (2)
Tests       14 passed (14)
```

Full package suite: `npx vitest run` → 5 files, 45 tests passed (no regressions elsewhere in `packages/testing`).

`npx tsc --noEmit` in `packages/testing` → clean, no errors.
`npx prettier --check` on the three touched files → all pass.

### Per-test results (new file)

| Test                                                                                                     | Result |
| -------------------------------------------------------------------------------------------------------- | ------ |
| `should suppress a dispatch to a command with no registered handler and record it as unhandled`          | PASS   |
| `should rethrow a business-rule error from a directly-dispatched command and record it in commandErrors` | PASS   |
| `should record a saga reaction command's business-rule error in commandErrors without vanishing`         | PASS   |
| `should not record a successfully dispatched command as unhandled or errored`                            | PASS   |

### Pre-existing file (regression check)

All 10 tests in `packages/testing/src/__tests__/domain-harness.test.ts` — PASS, unmodified.

---

## Requirements Coverage

| Requirement                                                                                   | Covered                                                                                                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1. Every dispatched command pushed to `dispatchedCommands` regardless of outcome              | YES                                                                                                             |
| 2. Exact missing-handler match suppressed + recorded in `unhandledCommands`                   | YES                                                                                                             |
| 3a/3b. Other errors recorded in `commandErrors` and rethrown with original identity           | YES (`throw error` rethrows the caught reference unchanged)                                                     |
| 4. Successful dispatch absent from both `unhandledCommands` and `commandErrors`               | YES                                                                                                             |
| 5. Missing-handler match scoped to dispatched command's own name (no generic substring match) | YES (`isMissingHandlerError` interpolates `commandName` into the exact expected string, equality not substring) |

---

## Notes for Auditor

- **Undocumented-in-spec-text gap**: the spec's Behavioral Requirements describe only `commandBus.dispatch`, but Test Scenarios 2 and 4 dispatch via `domain.dispatchCommand` with aggregate-routed commands — a path that `@noddde/engine`'s `Domain.dispatchCommand` sends straight to the command executor, never touching `commandBus.dispatch`. This was not stated anywhere in the spec's prose (Behavioral Requirements, Invariants, Edge Cases, or Integration Points), only implied by the ready-made test code. I added a second, narrower wrapper on `domain.dispatchCommand` (gated to aggregate-decide command names to avoid double-counting) to satisfy this. Worth flagging in case the spec's prose should be updated to document this integration point explicitly (Integration Points section currently only mentions the saga-executor path, not the `dispatchCommand` fast-path bypass).
- `(domain as { dispatchCommand: unknown }).dispatchCommand = ...` uses a narrow type escape hatch to reassign the class method's instance-shadowing property; `tsc --noEmit` is clean with this cast, and no `any` leaks into the function's declared exports.
- No CLI template changes needed — this spec doesn't touch aggregate/projection/saga scaffold shapes.
- No `packages/core`, `packages/engine`, `packages/cli`, or `samples/*` files were touched.
