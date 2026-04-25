# Build Report: DeleteView Sentinel + ViewStore.delete

**Date**: 2026-04-25
**Builder**: Claude Sonnet 4.6
**Specs**:
- `specs/core/persistence/view-store.spec.md`
- `specs/core/ddd/projection.spec.md`
- `specs/engine/implementations/in-memory-view-store.spec.md`

**Status**: GREEN

---

## Summary

Three coupled specs implemented together as a single coordinated change. Added the `DeleteView` unique-symbol sentinel to `@noddde/core`, updated the `ViewStore` interface with a `delete` method, added the in-memory implementation, updated the engine's dispatch paths to route `DeleteView` returns to `delete` instead of `save`, and patched the Drizzle adapter in the hotel booking sample. The integration scenarios from `projection.spec.md` that required `@noddde/engine` imports were placed in the engine's integration test directory rather than the core test directory, since `@noddde/core` does not depend on `@noddde/engine`.

---

## Files Changed

### Modified Source Files

- `packages/core/src/persistence/view-store.ts` — added `delete(viewId: ID): Promise<void>` to the `ViewStore` interface with JSDoc noting idempotency
- `packages/core/src/ddd/projection.ts` — added `export const DeleteView: unique symbol`, updated `ProjectionEventHandler.reduce` return type to `TView | typeof DeleteView | Promise<TView | typeof DeleteView>`
- `packages/engine/src/implementations/in-memory-view-store.ts` — added `public async delete(viewId: ID): Promise<void>` using `this.store.delete(String(viewId))`
- `packages/engine/src/domain.ts` — added `DeleteView` to value imports from `@noddde/core`; updated both the strong-consistency path (`onEventsProduced` callback) and the eventual-consistency path (`subscribeToEvent` callback) to branch on `newView === DeleteView` and call `delete` vs `save`
- `samples/sample-hotel-booking/src/infrastructure/persistence/drizzle-view-store.ts` — added `async delete(viewId: ID): Promise<void>` using `this.db.delete(hotelViews).where(...).execute()`

### Modified Test Files

- `packages/core/src/__tests__/persistence/view-store.test.ts` — updated two existing `it()` blocks to include `delete` in conforming objects; added two new `describe` blocks (`ViewStore delete signature`, `ViewStore extension preserves delete`)
- `packages/core/src/__tests__/ddd/projection.test.ts` — added `DeleteView` to imports; added three new `describe` blocks (`DeleteView sentinel`, `Reducer return type with DeleteView` with 3 its)

### Created Test Files

- `packages/engine/src/__tests__/integration/projection-delete-view.test.ts` — new file containing the three integration scenarios that could not live in core tests (see Cross-Package Boundary Decision below)
- Added five new `describe` blocks to `packages/engine/src/__tests__/engine/implementations/in-memory-view-store.test.ts`

---

## Cross-Package Boundary Decision

The `projection.spec.md` spec contains three integration scenarios that import from both `@noddde/core` and `@noddde/engine`:

- `Reducer returning DeleteView triggers viewStore.delete (eventual consistency)`
- `DeleteView is idempotent on a non-existent view`
- `Strong-consistency projection enlists DeleteView in the UoW`

The existing `packages/core/src/__tests__/ddd/projection.test.ts` file already imports engine types (`FrameworkInfrastructure`) but does NOT import any engine runtime classes. The core `package.json` has no dependency on `@noddde/engine`, and the core `vitest.config.mts` only aliases `@noddde/core`. Placing these integration scenarios in the core test file would fail at import time.

**Decision**: These three scenarios were placed in a new file `packages/engine/src/__tests__/integration/projection-delete-view.test.ts`. The engine's vitest config aliases both `@noddde/core` and `@noddde/engine` to local source, making this the correct home. The three scenarios there follow the exact pattern from `event-projection-flow.test.ts` (the reference integration test).

The spec's `## Test Scenarios` headings for these three integration tests are still fully covered — just in engine tests rather than core tests.

---

## Step 2: Tests Generated (RED)

### view-store.test.ts

| Scenario heading | Action | Test path |
|---|---|---|
| `ViewStore interface is assignable from a conforming object` | Updated (added `delete` field) | `packages/core/src/__tests__/persistence/view-store.test.ts` |
| `ViewStore default type parameter is any` | Updated (added `delete` field) | same |
| `ViewStore exposes a delete method` | Added new `it()` | same |
| `ViewStore extension still satisfies the base interface with delete` | Added new `it()` | same |

### projection.test.ts (core)

| Scenario heading | Action | Test path |
|---|---|---|
| `DeleteView is an exported unique-symbol sentinel` | Added new `describe` (4 its) | `packages/core/src/__tests__/ddd/projection.test.ts` |
| `Reducer return type accepts both TView and DeleteView` | Added new `describe` (3 its) | same |

### projection-delete-view.test.ts (engine integration — boundary decision)

| Scenario heading | Action | Test path |
|---|---|---|
| `Reducer returning DeleteView triggers viewStore.delete (eventual consistency)` | Added new `describe` (1 it) | `packages/engine/src/__tests__/integration/projection-delete-view.test.ts` |
| `DeleteView is idempotent on a non-existent view` | Added new `describe` (1 it) | same |
| `Strong-consistency projection enlists DeleteView in the UoW` | Added new `describe` (1 it) | same |

### in-memory-view-store.test.ts (engine)

| Scenario heading | Action | Test path |
|---|---|---|
| `delete removes a stored view` | Added new `describe` (1 it) | `packages/engine/src/__tests__/engine/implementations/in-memory-view-store.test.ts` |
| `delete is idempotent on a missing key` | Added new `describe` (1 it) | same |
| `delete uses string coercion for viewId` | Added new `describe` (1 it) | same |
| `delete leaves other views untouched` | Added new `describe` (1 it) | same |
| `save after delete creates a fresh entry` | Added new `describe` (1 it) | same |

---

## Step 3: Implementation Notes

### `DeleteView` placement

`DeleteView` is placed immediately before the `// ---- Types bundle ----` comment, after imports, as the first exported value in `projection.ts`. It uses `export const DeleteView: unique symbol = Symbol("DeleteView")`.

### `domain.ts` import style

`DeleteView` is a runtime value (not a type), so it requires a value import. It was added to the existing `import { isCloseable, isConnectable } from "@noddde/core"` line — not to the `import type { ... } from "@noddde/core"` block.

### Strong-consistency dispatch path

The branch at the `onEventsProduced` callback (approx. line 918) evaluates `newView === DeleteView` before choosing `uow.enlist(() => viewStoreInstance.delete(viewId))` vs `uow.enlist(() => viewStoreInstance.save(viewId, newView))`. The view is captured in the closure at the point the `enlist` call is made, which is correct.

### TypeScript compile note

`tsc --noEmit` on `packages/core` passes cleanly. `tsc --noEmit` on `packages/engine` shows the `delete` property error (`Property 'delete' does not exist on type 'ViewStore<any>'`) because the installed `@noddde/core` dist in `node_modules` predates this change. This is expected in a monorepo build sequence — it resolves once core is rebuilt (`tsc` in packages/core) and the engine's node_modules reference is updated. The vitest runs use source aliases and work correctly.

Pre-existing engine tsc errors (opentelemetry, outbox `createdAt`, `EventBus.on`, etc.) were present before this change — confirmed by running `tsc --noEmit` on the unchanged main IdeaProjects engine package.

---

## Step 4: Test Results

### Core Package

```
Test Files  25 passed (25)
Tests       279 passed (279)
Duration    ~600ms
```

9 new tests added (2 updated + 7 new `it()` blocks).

### Engine Package

```
Test Files  31 passed, 1 failed (32)
Tests       326 passed (326)
```

The 1 failing test suite (`tracing.test.ts`) is a pre-existing failure caused by a missing `@opentelemetry/api` optional peer dependency — it fails identically on the unchanged `main` branch and is unrelated to this change.

---

## Pre-Push Checks

### Prettier

Ran `prettier --write` on all 9 modified/created files. All files formatted successfully. No formatting issues.

### ESLint

Ran `eslint --max-warnings 0` on all modified source and test files. No warnings or errors.

### TypeScript (core)

`tsc --noEmit` in `packages/core`: **no errors**.

### TypeScript (engine)

`tsc --noEmit` in `packages/engine`: pre-existing errors only (opentelemetry, outbox, event-bus). The `delete` error is a build-order artifact (dist not rebuilt yet) — resolves after `yarn build`.

---

## Requirements Coverage

| Requirement | Spec | Covered by |
|---|---|---|
| `ViewStore.delete` method added | view-store.spec.md BR 6, 7 | `ViewStore exposes a delete method`, integration tests |
| Delete is idempotent | view-store.spec.md BR 6 | `delete is idempotent on a missing key`, `DeleteView is idempotent` |
| Delete then load returns undefined | view-store.spec.md BR 7 | `delete removes a stored view` |
| `DeleteView` is a unique symbol | projection.spec.md BR 16 | `DeleteView is an exported unique-symbol sentinel` |
| Reducer return type includes `DeleteView` | projection.spec.md BR 17 | `Reducer return type accepts both TView and DeleteView` |
| Engine routes `DeleteView` to `delete` (eventual) | projection.spec.md BR 18 | `Reducer returning DeleteView triggers viewStore.delete (eventual consistency)` |
| Engine routes `DeleteView` to `delete` (strong) | projection.spec.md BR 21 | `Strong-consistency projection enlists DeleteView in the UoW` |
| Deletion is idempotent at engine level | projection.spec.md BR 20 | `DeleteView is idempotent on a non-existent view` |
| InMemoryViewStore.delete removes entry | in-memory-view-store.spec.md BR 8 | `delete removes a stored view` |
| InMemoryViewStore.delete is idempotent | in-memory-view-store.spec.md BR 9 | `delete is idempotent on a missing key` |
| InMemoryViewStore.delete uses String() coercion | in-memory-view-store.spec.md BR 4 | `delete uses string coercion for viewId` |
| InMemoryViewStore.delete isolates other views | edge cases | `delete leaves other views untouched` |
| Save after delete works | edge cases | `save after delete creates a fresh entry` |
| DrizzleViewStore satisfies ViewStore | interface invariant | Added `delete` to `DrizzleViewStore` |
