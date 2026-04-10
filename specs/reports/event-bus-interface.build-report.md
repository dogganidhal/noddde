# Build Report: EventBus Interface + EventEmitterEventBus Update

**Specs**: `specs/core/edd/event-bus.spec.md`, `specs/engine/implementations/ee-event-bus.spec.md`
**Builder**: Claude Sonnet 4.6
**Date**: 2026-04-10
**Status**: GREEN — all tests pass

---

## Changes Made

### Spec 1: EventBus Interface (Core)

**File**: `packages/core/src/edd/event-bus.ts`

- Added `AsyncEventHandler` exported type: `(event: Event) => void | Promise<void>`
- Added `on(eventName: string, handler: AsyncEventHandler): void` method to the `EventBus` interface
- Extended `EventBus` with `Closeable` (imported from `../infrastructure/closeable`), adding `close(): Promise<void>` to the interface contract

**File**: `packages/core/src/__tests__/edd/event-bus.test.ts`

- Replaced existing tests with full spec-derived test scenarios (7 tests)
- All tests are type-level using `expectTypeOf` — no runtime object construction
- Covers: `dispatch` parameter/return types, `on` method signature, `Closeable` extension, `AsyncEventHandler` type, structural implementation

### Spec 2: EventEmitterEventBus (Engine)

**File**: `packages/engine/src/implementations/ee-event-bus.ts`

- Imported `AsyncEventHandler` from `@noddde/core` instead of defining locally
- Added `close(): Promise<void>` public method (idempotent, clears all handlers)
- `removeAllListeners()` made private (called by `close()`)

**File**: `packages/engine/src/__tests__/engine/implementations/ee-event-bus.test.ts`

- Replaced existing tests with full spec-derived test scenarios (9 tests)
- New tests cover: full event object forwarding, no-handler no-op, multiple handlers fan-out, double dispatch, channel isolation, sequential async awaiting, metadata forwarding, `close()` clears handlers, `close()` idempotency

### Domain Fix

**File**: `packages/engine/src/domain.ts`

- `subscribeToEvent()`: removed `(eventBus as EventEmitterEventBus).on(eventName, handler)` cast — now calls `eventBus.on(eventName, handler)` directly on the interface
- `_performShutdown()`: replaced `removeAllListeners` duck-type check with `await eventBus.close()` — uses `Closeable` contract directly
- `EventEmitterEventBus` import is retained (still used for instantiation in `cqrsInfra`)

### TypeScript Path Fix

**File**: `packages/engine/tsconfig.json`

- Added `"paths": { "@noddde/core": ["../core/src/index.ts"] }` so `tsc --noEmit` resolves to the worktree's updated core source instead of the installed (stale) dist

---

## Test Results

### Core Package

```
Test Files: 25 passed (25)
Tests:      262 passed (262)
```

Key: `src/__tests__/edd/event-bus.test.ts` — 7 tests, all GREEN

### Engine Package

```
Test Files: 30 passed, 1 failed (31)
Tests:      315 passed (315)
```

Key: `src/__tests__/engine/implementations/ee-event-bus.test.ts` — 9 tests, all GREEN

The 1 failed suite is `tracing.test.ts` — pre-existing failure due to `@opentelemetry/api` peer dependency not installed in the worktree. Unrelated to this change.

---

## Type Check Results

### Core (`npx tsc --noEmit`)

**Clean** — no errors.

### Engine (`npx tsc --noEmit`)

Only pre-existing errors remain (5 lines, all `@opentelemetry/api` not found — peer dependency missing). No new errors introduced.

---

## Spec Compliance Notes

- `EventBus` now satisfies: `dispatch`, `on`, `close` (via `Closeable`)
- `AsyncEventHandler` exported from `@noddde/core` (via `edd/index.ts` re-export chain)
- Domain no longer uses any type casts against `EventEmitterEventBus` for subscription or shutdown
- `close()` in `EventEmitterEventBus` is idempotent (clears `Map`, safe to call multiple times)
- All behavioral requirements from both specs are covered by tests

---

## Files Modified

- `packages/core/src/edd/event-bus.ts` — interface update
- `packages/core/src/__tests__/edd/event-bus.test.ts` — tests replaced
- `packages/engine/src/implementations/ee-event-bus.ts` — `close()` added, `AsyncEventHandler` imported from core
- `packages/engine/src/__tests__/engine/implementations/ee-event-bus.test.ts` — tests replaced
- `packages/engine/src/domain.ts` — cast removed, shutdown updated
- `packages/engine/tsconfig.json` — paths added for worktree resolution
- `specs/core/edd/event-bus.spec.md` — status set to `implementing`
