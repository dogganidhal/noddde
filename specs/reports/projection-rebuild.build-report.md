# Projection Rebuild API — Build Report

**Feature:** Projection Rebuild API  
**Builder:** Claude Sonnet 4.6  
**Date:** 2026-05-19  
**Status:** PASS

---

## Specs Implemented

| Spec | Status Before | Status After |
|------|--------------|--------------|
| `specs/core/persistence/event-reader.spec.md` | ready | implemented |
| `specs/core/persistence/view-store.spec.md` | implemented (truncate added) | implemented |
| `specs/core/persistence/adapter.spec.md` | implemented (eventReader added) | implemented |
| `specs/engine/implementations/in-memory-view-store.spec.md` | implemented (truncate added) | implemented |
| `specs/engine/implementations/in-memory-aggregate-persistence.spec.md` | implemented (read() added) | implemented |
| `specs/engine/projection-rebuild.spec.md` | ready | implemented |
| `specs/engine/domain.spec.md` | ready | implemented |

---

## Files Created

- `packages/core/src/persistence/event-reader.ts` — `EventReader` and `EventReadOptions` interfaces
- `packages/core/src/__tests__/persistence/event-reader.test.ts` — EventReader type contract tests
- `packages/engine/src/projection-rebuild.ts` — All 5 error classes, `ProjectionRebuildOptions`, `ProjectionRebuildResult`, `RebuildContext`, `rebuildProjectionImpl`
- `packages/engine/src/__tests__/integration/projection-rebuild.test.ts` — 13 integration tests (all from spec scenarios)

## Files Modified

- `packages/core/src/persistence/view-store.ts` — added `truncate?(): Promise<void>` to `ViewStore` interface
- `packages/core/src/persistence/adapter.ts` — added `eventReader?: EventReader` to `PersistenceAdapter`
- `packages/core/src/persistence/index.ts` — re-exported `EventReader`, `EventReadOptions`
- `packages/core/src/__tests__/persistence/view-store.test.ts` — added truncate tests
- `packages/core/src/__tests__/persistence/adapter.test.ts` — added eventReader field tests
- `packages/engine/src/implementations/in-memory-view-store.ts` — added `truncate()` method
- `packages/engine/src/implementations/in-memory-aggregate-persistence.ts` — added `read()` method, implements `EventReader`
- `packages/engine/src/implementations/ee-event-bus.ts` — added `off()` method for subscription removal
- `packages/engine/src/domain.ts` — added `TProjections` generic param, `_projectionSubscriptions` registry, `_persistenceResolver`, `_resolvedViewStoreFactories`, `_resolvedProjections` fields; updated step 10 to record subscription references; added `rebuildProjection()` method; updated `InferDomain` and `wireDomain` to thread `TProjections`
- `packages/engine/src/index.ts` — added `export * from "./projection-rebuild"`
- `packages/engine/src/__tests__/engine/implementations/in-memory-view-store.test.ts` — added truncate tests
- `packages/engine/src/__tests__/engine/implementations/in-memory-aggregate-persistence.test.ts` — added `read()` tests
- `specs/core/persistence/event-reader.spec.md` — status: ready → implemented
- `specs/engine/projection-rebuild.spec.md` — status: ready → implemented
- `specs/engine/domain.spec.md` — status: ready → implemented

---

## Test Results

- **core tests**: 238/238 passing
- **engine tests**: 437/437 passing (includes 13 new projection-rebuild integration tests)
- **Total new tests added**: 35 (13 projection-rebuild integration + ~8 truncate/read in implementations + ~14 EventReader/adapter type tests)
- No regressions in existing tests

---

## TypeScript

Both packages compile clean with `tsc --noEmit`:
- `packages/core` — 0 errors
- `packages/engine` — 0 errors

---

## Pre-Push Checks

- Prettier: all modified/new files formatted
- ESLint: 0 warnings, 0 errors in both packages
- TypeScript: 0 errors in both packages
- All tests: GREEN

---

## Key Implementation Decisions

1. **`EventBus.off()` is not on the interface** — Added `off()` only to `EventEmitterEventBus`. `rebuildProjectionImpl` uses a conditional cast `eventBus as EventBus & { off?: ... }` and throws an explanatory error if the bus lacks `off`. This is consistent with the spec's note that production adapters typically support removal.

2. **EventReader structural fallback** — `rebuildProjection` first checks `adapter.eventReader`, then structurally scans the `_persistenceResolver` for any persistence object with a callable `read` method. This means the in-memory event-sourced persistence (which now implements `EventReader`) is picked up automatically without any adapter wiring.

3. **Subscription registry** — Step 10 of `init()` now stores `boundHandler` references in `_projectionSubscriptions: Map<projectionName, Map<eventName, handler>>` before calling `subscribeToEvent()`. Strong-consistency projections are skipped (they are never entered). The registry is read-only after `init()`.

4. **`TProjections` as 6th generic** — Added with default `= ProjectionMap` for full backward compatibility. `InferDomain` and `wireDomain` both thread `ExtractProjections<TDef>` so `domain.rebuildProjection("KnownProj")` is typed and `domain.rebuildProjection("Unknown")` is a compile-time error.

5. **`rebuildProjectionImpl` as internal helper** — Lives in `projection-rebuild.ts` but is not exported on the public surface (only its types and error classes are). The `RebuildContext` interface is `@internal`.

---

## CLI Template Assessment

No CLI template changes required. `rebuildProjection` is a runtime method on `Domain`, not part of the aggregate/projection/saga definition patterns that CLI scaffolding generates.
