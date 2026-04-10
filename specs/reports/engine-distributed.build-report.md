# Build Report: Engine Distributed Systems Fixes

**Date**: 2026-04-10
**Builder**: Sonnet (claude-sonnet-4-6)
**Status**: GREEN

## Summary

Two distributed systems fixes were applied to the engine package:

1. **Sequential event dispatch** — All three event dispatch sites now use `for...of` instead of `Promise.all` to preserve causal ordering.
2. **Handler registration before auto-connect** — Auto-connect was moved from step 2b to step 13b in `Domain.init()`, after all handler registration.

## Changes Made

### Fix 1: Sequential event dispatch

**`packages/engine/src/executors/command-lifecycle-executor.ts`** (line ~166)

- Replaced `await Promise.all(events.map((e) => eventBus.dispatch(e)))` with sequential `for...of` loop.

**`packages/engine/src/executors/saga-executor.ts`** (lines ~159-162)

- Replaced `await Promise.all(events.map((e) => this.infrastructure.eventBus.dispatch(e)))` with sequential `for...of` loop.
- Updated comment from "in parallel" to "sequentially".

**`packages/engine/src/domain.ts`** — `withUnitOfWork()` method (line ~1332)

- Replaced `await Promise.all(events.map((e) => this._infrastructure.eventBus.dispatch(e)))` with sequential `for...of` loop.

**Why**: Parallel dispatch breaks event ordering. Events from a single command must arrive at consumers in the order they were produced by the aggregate's evolve chain.

### Fix 2: Auto-connect after handler registration

**`packages/engine/src/domain.ts`** — `init()` method

- Removed the auto-connect block from step 2b (between bus resolution and infrastructure merge).
- Added a new auto-connect block at step 13b (after standalone event handler registration, steps 6-13 complete).
- Added explanatory comment about the race condition being prevented.

**Why**: Broker-backed buses deliver queued messages immediately on `connect()`. If handlers are not yet registered, those messages are silently dropped. Moving connect after all handler registration (steps 6-13) ensures handlers are ready before the bus starts delivering.

### Test update

**`packages/engine/src/__tests__/engine/domain.test.ts`**

- Added new test: "should auto-connect buses AFTER all handler registration to prevent race conditions"
- This test verifies that all `on()` calls (handler registration) complete before any `connect()` call by tracking call order.

## Test Results

- **Test files**: 31 passed
- **Tests**: 330 passed (0 failed)
- **TypeScript**: `tsc --noEmit` — 0 errors

## Specs Satisfied

- `specs/engine/domain.spec.md` — Step 2 note (auto-connect deferred to 13b), Step 13b (auto-connect after all handler registration)
- `specs/engine/executors/command-lifecycle-executor.spec.md` — Requirement 11 (sequential dispatch after UoW commit), Requirement 15 (sequential dispatch after implicit UoW commit)
- `specs/engine/executors/saga-executor.spec.md` — Requirement 12 (sequential dispatch after saga UoW commit)
