# Audit Report: Engine Parallel Event Dispatch

**Date**: 2026-04-10
**Auditor**: Opus 4.6
**Cycle**: 1
**Result**: **FAIL**

---

## Phase A: Validation

### A1: Read Everything

All three specs, all three source files, and the Build Report were reviewed.

### A2: Mechanical Checks

| Check                      | Result                 | Notes                                                                                                                          |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `tsc --noEmit` (engine)    | PASS                   | Zero errors                                                                                                                    |
| `vitest run` (executors)   | PASS                   | 24/24 pass                                                                                                                     |
| `vitest run` (full engine) | 28 failures in 8 files | All pre-existing (Connectable, Closeable, outbox Date type, tracing OTel, adapter-wiring) -- none related to parallel dispatch |
| No stubs                   | PASS                   | No stubs found                                                                                                                 |

### A3: Coherence Review

#### Dispatch Site Verification

| File                            | Line | Spec Requirement              | Expected                       | Actual                                                                      | Verdict  |
| ------------------------------- | ---- | ----------------------------- | ------------------------------ | --------------------------------------------------------------------------- | -------- |
| `command-lifecycle-executor.ts` | 166  | Req 15                        | `Promise.all(events.map(...))` | `Promise.all(events.map((e) => eventBus.dispatch(e)))`                      | PASS     |
| `domain.ts` (`withUnitOfWork`)  | 1332 | Domain spec req 6 / invariant | `Promise.all(events.map(...))` | `Promise.all(events.map((e) => this._infrastructure.eventBus.dispatch(e)))` | PASS     |
| `saga-executor.ts`              | 160  | Req 12                        | `Promise.all(events.map(...))` | `for (const deferredEvent of events) { await ...dispatch(deferredEvent); }` | **FAIL** |

#### Finding: saga-executor.ts dispatch not changed

**Location**: `packages/engine/src/executors/saga-executor.ts`, lines 160-162

**Spec requirement**: `specs/engine/executors/saga-executor.spec.md`, requirement 12 states: "dispatch all returned events in parallel via `await Promise.all(events.map(e => infrastructure.eventBus.dispatch(e)))`"

**Actual code**:

```ts
for (const deferredEvent of events) {
  await this.infrastructure.eventBus.dispatch(deferredEvent);
}
```

**Build Report claim**: The Build Report states this was changed to `await Promise.all(events.map((e) => this.infrastructure.eventBus.dispatch(e)));` at line 160. This is incorrect -- the sequential loop remains in the source.

**Fix**: Replace lines 160-162 with:

```ts
await Promise.all(events.map((e) => this.infrastructure.eventBus.dispatch(e)));
```

#### Other Observations

- **Outbox post-dispatch marking**: Correctly runs AFTER `Promise.all` settles in both `command-lifecycle-executor.ts` (line 169) and `domain.ts` (line 1337). In `saga-executor.ts`, the callback runs after the sequential loop, which would remain correct after the fix.
- **No missed dispatch sites**: The only other `for...of` event loop in `domain.ts` line 921 is for strong-consistency projection reduction within UoW -- not an event bus dispatch. Correctly left sequential.
- **Outbox relay** (`outbox-relay.ts` line 100): Uses sequential dispatch intentionally -- each entry is dispatched and marked individually for retry granularity. This is not in scope for this change.

### Documentation Review

`docs/content/docs/running/event-bus-adapters.mdx` does not reference sequential vs. parallel event dispatch at the engine level. No documentation updates required.

---

## Verdict: FAIL

### Reason

1 of 3 dispatch sites was not changed. The `saga-executor.ts` still uses sequential `for...of` dispatch, violating spec requirement 12.

### Required Fix

| Location                                                 | Fix                                                                                                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/executors/saga-executor.ts:160-162` | Replace `for (const deferredEvent of events) { await this.infrastructure.eventBus.dispatch(deferredEvent); }` with `await Promise.all(events.map((e) => this.infrastructure.eventBus.dispatch(e)));` |

This is a one-line mechanical substitution identical to the two sites that were correctly changed.
