# Audit Report: Projection view deletion via DeleteView sentinel

**Date**: 2026-04-25
**Auditor**: Claude Opus 4.7 (1M context)
**Cycle**: 1
**Specs reviewed**:

- `specs/core/persistence/view-store.spec.md` (added `delete(viewId): Promise<void>` to `ViewStore<TView>`)
- `specs/core/ddd/projection.spec.md` (added `DeleteView: unique symbol` and reducer return-type union)
- `specs/engine/implementations/in-memory-view-store.spec.md` (implements `delete`)

**Build Report reviewed**: `specs/reports/projection-deletion.build-report.md`

---

## Verdict: PASS

The Builder shipped a correct, coherent implementation. The engine routes `DeleteView` to `viewStore.delete` on both the eventual and strong-consistency paths, the `if/else` branches are mutually exclusive, the in-memory and Drizzle stores are both updated to implement `delete`, and all behavioral spec requirements (1 through 21 on the projection spec, 1 through 7 on the view-store spec, 1 through 9 on the in-memory spec) are exercised by tests.

Two test-fixture defects were identified by an out-of-band TypeScript check against the worktree source (the workspace `node_modules/@noddde/core` symlink resolves to a stale dist, which masks them in default tooling). Both were minor, mechanical, and fixable by the Auditor — they have been corrected in this cycle. Details in the Concerns section.

---

## Phase A: Validation

### A1: Mechanical Checks

| Check                                                            | Result | Details                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DeleteView` exported from `@noddde/core`                        | PASS   | Declared at `packages/core/src/ddd/projection.ts:30` as `export const DeleteView: unique symbol = Symbol("DeleteView")`. Reachable via `ddd/index.ts → src/index.ts`. Listed in spec frontmatter `exports`.                                                                                                                                                              |
| `ViewStore.delete` on the public interface                       | PASS   | `packages/core/src/persistence/view-store.ts:54` declares `delete(viewId: ID): Promise<void>` as a required member. JSDoc at lines 48-53 documents the idempotency contract.                                                                                                                                                                                             |
| Engine routes `DeleteView` to `viewStore.delete` (eventual path) | PASS   | `packages/engine/src/domain.ts:1126-1133`: `if (newView === DeleteView) await viewStoreInstance.delete(viewId); else await viewStoreInstance.save(viewId, newView)` — mutually exclusive, single delete call per event.                                                                                                                                                  |
| Engine routes `DeleteView` to UoW.enlist on strong path          | PASS   | `packages/engine/src/domain.ts:917-922`: `uow.enlist(() => viewStoreInstance.delete(viewId))` vs `uow.enlist(() => viewStoreInstance.save(viewId, newView))`. Atomic with the originating command's UoW; rolls back together on failure.                                                                                                                                 |
| Engine awaits before sentinel comparison                         | PASS   | Both dispatch sites (eventual + strong) call `const newView = await handler.reduce(event, currentView)` and then check `if (newView === DeleteView)`. Async reducers (`Promise<typeof DeleteView>`) are correctly resolved.                                                                                                                                              |
| In-memory `delete` implementation                                | PASS   | `packages/engine/src/implementations/in-memory-view-store.ts:50-52` calls `this.store.delete(String(viewId))`. Naturally idempotent (Map.delete returns false on missing keys, never throws). String coercion matches `save`/`load`.                                                                                                                                     |
| Drizzle `delete` implementation                                  | PASS   | `samples/sample-hotel-booking/src/infrastructure/persistence/drizzle-view-store.ts:88-98` deletes by `(view_type, view_id)`. Naturally idempotent at SQL level (no rows match → no-op).                                                                                                                                                                                  |
| All other `ViewStore` implementers updated                       | PASS   | Repo grep finds two concrete implementers: `InMemoryViewStore` (updated) and `DrizzleViewStore` (updated). `InMemoryRoomAvailabilityViewStore` extends `InMemoryViewStore` and inherits `delete`. `RoomAvailabilityViewStore` is an interface that extends `ViewStore` and inherits the `delete` requirement at the type level.                                          |
| Stub check (no `throw new Error("Not implemented")`)             | PASS   | Grep across the three modified source files returns 0 hits.                                                                                                                                                                                                                                                                                                              |
| `tsc --noEmit -p packages/core/tsconfig.json`                    | PASS   | 0 errors. (This config excludes `__tests__/`, so test-file errors aren't surfaced here — see Concerns.)                                                                                                                                                                                                                                                                  |
| `tsc --noEmit -p packages/engine/tsconfig.json`                  | PASS\* | The Builder noted pre-existing engine tsc errors caused by the worktree symlink (`node_modules/@noddde/core` → stale `IdeaProjects/noddde` dist that lacks `DeleteView` and `delete`). Confirmed pre-existing: those errors reference `isConnectable`, `AsyncEventHandler`, `OutboxEntry.createdAt`, and `@opentelemetry/api`, none of which are touched by this change. |
| Vitest core (`view-store.test.ts` + `projection.test.ts`)        | PASS   | 7/7 ViewStore tests + 37/37 Projection tests = 44/44 GREEN. Full core suite: 279/279 GREEN.                                                                                                                                                                                                                                                                              |
| Vitest engine (`in-memory-view-store.test.ts` + integration)     | PASS   | 14/14 InMemoryViewStore tests + 3/3 integration tests = 17/17 GREEN. Full engine suite: 326/326 GREEN (1 pre-existing tracing suite failure due to missing optional `@opentelemetry/api` peer dep — unrelated).                                                                                                                                                          |
| CLI template still type-checks                                   | PASS   | `packages/cli/src/templates/domain/projection-view-reducers.ts` returns `${ctx.name}View` from a reducer. Adding `typeof DeleteView` to the union return type is **additive**; existing user-generated reducers that return only the view object remain valid. No template update is required for this change.                                                           |

### A2: Spec-to-Code Traceability (per behavioral requirement)

#### `view-store.spec.md`

| Req | Statement                                  | Implementation                                                       | Test                                                                                       | Verdict |
| --- | ------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------- |
| 1   | Generic over view type                     | `ViewStore<TView = any>` declares `save(viewId, view: TView)`        | `ViewStore`/`ViewStore default type` tests                                                 | PASS    |
| 2   | Default `TView = any`                      | Line 29 default param                                                | `ViewStore default type` test                                                              | PASS    |
| 3   | Extensible with custom query methods       | Interface, not class                                                 | `ViewStore extension` + `extension preserves delete`                                       | PASS    |
| 4   | `*Store` naming convention                 | Name `ViewStore`                                                     | N/A (naming inspection)                                                                    | PASS    |
| 5   | `viewId: ID`                               | Line 37, 46, 54                                                      | `ViewStore ID parameter`                                                                   | PASS    |
| 6   | Delete is idempotent                       | JSDoc explicit; `InMemoryViewStore` and `DrizzleViewStore` both safe | `InMemoryViewStore delete idempotency`; `DeleteView idempotency` (integration)             | PASS    |
| 7   | Delete is total (subsequent load → absent) | Implementation removes the entry                                     | `InMemoryViewStore delete` + `delete isolation`; integration test asserts `load` undefined | PASS    |

#### `projection.spec.md`

| Req    | Statement                                           | Implementation                                                                       | Test                                                              | Verdict |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------- |
| 1      | Reducer receives full event                         | `reduce: (event: TEvent, view: TView) => ...`                                        | `Reducer event parameter`                                         | PASS    |
| 2      | Sync or async                                       | Return type union includes `Promise<...>`                                            | `Async reducers`, `should accept async reducers that ...`         | PASS    |
| 3      | Partial `on` map                                    | `ProjectionOnMap<T>` uses `?:`                                                       | `Partial on map`                                                  | PASS    |
| 4      | Optional query handlers                             | `QueryHandlerMap<T>` uses `?:`                                                       | `Optional query handlers`                                         | PASS    |
| 5      | `defineProjection` is identity                      | Returns config as-is                                                                 | `defineProjection identity`                                       | PASS    |
| 6      | Conditional `viewStore` injects `{ views }`         | `ProjectionQueryInfra<T>` conditional                                                | `Query handlers with views injection`                             | PASS    |
| 7      | Without `viewStore` → plain infra                   | Else branch                                                                          | `Query handlers without viewStore`                                | PASS    |
| 8      | `id` is optional per entry at the type level        | `id?:` in `ProjectionEventHandler`                                                   | `Optional id in on entries`                                       | PASS    |
| 9      | `initialView` provides default                      | Optional field on `Projection`                                                       | `Projection with initialView`                                     | PASS    |
| 10     | `consistency` defaults to eventual                  | Engine: `if (projection.consistency === "strong") continue` in eventual subscription | `Projection consistency mode`; integration tests for both modes   | PASS    |
| 11     | `ProjectionEventHandler` exported                   | Line 79 export                                                                       | Used in `InferProjectionEventHandler` test                        | PASS    |
| 12-15  | Infer\* utilities                                   | Lines 274-420                                                                        | `Projection Infer utilities`, `InferProjectionEventHandler`, etc. | PASS    |
| **16** | `DeleteView` is `unique symbol` from `@noddde/core` | `export const DeleteView: unique symbol = Symbol("DeleteView")`                      | `DeleteView sentinel` (4 sub-tests)                               | PASS    |
| **17** | Reducers may return `DeleteView`                    | Return type union `TView \| typeof DeleteView \| Promise<...>`                       | `Reducer return type with DeleteView`                             | PASS    |
| **18** | Engine routes to `viewStore.delete`, not `save`     | `if (newView === DeleteView) ... else ...` in both dispatch paths                    | `Eventual-consistency DeleteView` (integration)                   | PASS    |
| **19** | Conditional deletion supported                      | Engine inspects awaited return value at runtime                                      | `should accept reducers that conditionally return DeleteView`     | PASS    |
| **20** | Deletion idempotent on missing view                 | Engine still calls `delete`; `ViewStore` contract requires no-throw                  | `DeleteView idempotency` (integration)                            | PASS    |
| **21** | Strong-consistency deletion enlists in UoW          | `uow.enlist(() => viewStoreInstance.delete(viewId))` in `onEventsProduced`           | `Strong-consistency DeleteView` (integration)                     | PASS    |

#### `in-memory-view-store.spec.md`

| Req   | Statement                          | Implementation                                             | Test                                           | Verdict |
| ----- | ---------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ------- |
| 1     | Save stores by ID                  | `Map.set(String(viewId), view)`                            | round-trip test                                | PASS    |
| 2     | Load returns stored view           | `Map.get(String(viewId))`                                  | round-trip test                                | PASS    |
| 3     | Load returns undefined for missing | `Map.get` returns `undefined`                              | dedicated test                                 | PASS    |
| 4     | String coercion for all `ID` types | `String(viewId)` used in save/load/delete                  | `coerce numeric viewId`, `delete coercion`     | PASS    |
| 5     | Overwrite semantics                | Map.set overwrites                                         | `should overwrite view`                        | PASS    |
| 6     | findAll returns all views          | `[...store.values()]`                                      | `findAll` tests                                | PASS    |
| 7     | find filters by predicate          | `.filter(predicate)`                                       | `find filters views`                           | PASS    |
| **8** | Delete removes the entry           | `Map.delete(String(viewId))`                               | `InMemoryViewStore delete`, `delete isolation` | PASS    |
| **9** | Delete is idempotent               | Map.delete on missing key returns `false` but never throws | `InMemoryViewStore delete idempotency`         | PASS    |

### A3: Coherence Review

**Engine dispatch (both paths):**

- Eventual path: `packages/engine/src/domain.ts:1124-1133` — runs reducer, awaits, branches on `=== DeleteView`. Subscribes to event bus, runs after UoW commit.
- Strong path: `packages/engine/src/domain.ts:909-924` — same logic but enlists into the same UoW that commits aggregate changes. Runs **before** `commit`, so a UoW failure rolls everything back atomically. The engine deliberately skips strong-consistency projections in the event-bus subscription loop (`if (projection.consistency === "strong") continue` at line 1113) to avoid double-processing.

**Sentinel safety:**

- `DeleteView` is a `unique symbol`, so reference comparison (`===`) is the correct idiomatic check.
- The check is on the _awaited_ value, so `Promise<typeof DeleteView>` is supported.
- An async arrow `async () => DeleteView` widens the inferred return type to `Promise<symbol>` (TypeScript quirk for unique symbols inside a contextually-typed union return). The fix is an explicit return-type annotation: `async (): Promise<typeof DeleteView> => DeleteView`. The Auditor updated the spec/test/docs accordingly — see Concerns.

**Idempotency chain:**

- `InMemoryViewStore.delete` uses `Map.delete`, which is naturally idempotent.
- `DrizzleViewStore.delete` issues an SQL DELETE; missing rows produce no rows-affected, no error.
- The engine never bypasses `viewStore.delete` for missing views — it always calls it; the no-op is the contract.

**Engine path gate (`if (handler.id)`):**

- The engine only invokes the projection handler when `handler.id` is defined. For projections with auto-persistence configured, `domain.ts:863-882` defaults missing `id` extractors to `event.metadata.aggregateId` (with a startup warning). After that defaulting step, every handler has an `id`. So `DeleteView` reducers behind the gate are always reached when the engine knows which view to target.

**Breaking change propagation:**

- `ViewStore.delete` is now a _required_ member. The Auditor scanned the repo for `implements ViewStore` and `extends ViewStore`:
  - `InMemoryViewStore` — implements `delete`. ✓
  - `DrizzleViewStore` — implements `delete`. ✓
  - `InMemoryRoomAvailabilityViewStore` extends `InMemoryViewStore` — inherits `delete`. ✓
  - `RoomAvailabilityViewStore` is an interface extension (not a class) — inherits the `delete` requirement at the type level; concrete implementations satisfy it via the two classes above. ✓
- No external repos in this monorepo declare a third concrete `ViewStore` implementation. The breaking change is fully propagated within the worktree.

---

## Phase B: Documentation

The change is well-documented:

- **`docs/content/docs/read-model/view-persistence.mdx`** already contains a comprehensive `## Deleting Views with DeleteView` section (lines 216-296) covering:
  - Sentinel introduction and import
  - How the engine routes `DeleteView`
  - Conditional deletion example
  - Idempotency contract
  - Strong-consistency behavior
- **`docs/content/docs/read-model/projections.mdx`** mentions `DeleteView` in the event-handler properties (line 246), the "Deleting Views Conditionally" subsection (lines 263-283), and the engine-handling steps (lines 531-532).
- **`ViewStore` interface signature** in view-persistence.mdx is updated to include `delete(viewId): Promise<void>`.
- **`docs/public/llms.txt`** is a navigation index, not an API listing — the View Persistence link description is generic enough that no edit is required.

**Auditor edit during this cycle:** view-persistence.mdx:251 previously implied `async () => DeleteView` works directly. Updated to acknowledge the TypeScript widening behavior and prescribe the explicit annotation `async (): Promise<typeof DeleteView> => DeleteView`. Sync arrows were noted as needing no annotation.

---

## Concerns

The following two issues were caught by an out-of-band check (`tsc --noEmit` against the worktree source via path-mapping override). Default tooling did not catch them because:

1. The package's own `tsconfig.json` excludes `__tests__/`, so `yarn build` doesn't see them.
2. Vitest doesn't enforce TypeScript types when running tests.
3. The workspace `node_modules/@noddde/core` symlink resolves to a stale dist that lacks the new `delete` member, so tsc resolves test imports against the old shape and reports a different (mirror) class of errors.

Both issues are **test/spec-fixture defects** with the new feature. Behavioral source code is correct. The Auditor fixed both.

### Concern 1 — `ViewStore<string>` literal in test scenario missing `delete` (FIXED)

**Files**:

- `specs/core/persistence/view-store.spec.md` (Test Scenarios → "ViewStore accepts ID types for viewId", ~line 181-184)
- `packages/core/src/__tests__/persistence/view-store.test.ts:51-54`

The test scenario constructed `const store: ViewStore<string> = { save, load }` without `delete`. Once `delete` is required on `ViewStore`, this is a TS2741 missing-property error. The Auditor added `delete: async (_viewId: ID) => {}` and a matching `expectTypeOf(store.delete).parameter(0).toEqualTypeOf<ID>()` assertion to both the spec scenario and the test file. Verified: vitest still GREEN, tsc against worktree source no longer flags this site.

### Concern 2 — `async () => DeleteView` widens to `Promise<symbol>` (FIXED)

**Files**:

- `specs/core/ddd/projection.spec.md` (Test Scenarios → "Reducer return type accepts both TView and DeleteView" → third sub-test, ~line 1138)
- `packages/core/src/__tests__/ddd/projection.test.ts:800`
- `docs/content/docs/read-model/view-persistence.mdx:251`

When the contextual return type is the union `TView | typeof DeleteView | Promise<TView | typeof DeleteView>`, TypeScript widens an async arrow's inferred return from `Promise<typeof DeleteView>` to `Promise<symbol>` — which is then not assignable. This is a known TypeScript quirk for unique symbols. The fix is an explicit return-type annotation:

```ts
reduce: async (): Promise<typeof DeleteView> => DeleteView;
```

The Auditor updated spec, test, and docs. Verified: vitest still GREEN, tsc against worktree source no longer flags line 800.

### Note on the workspace symlink

The Builder correctly identified the stale `node_modules/@noddde/core` symlink as the cause of the "pre-existing engine tsc errors" — those errors are NOT regressions from this change. However, the Auditor recommends the developer rebuild + re-link the core package in this worktree (`yarn build` in `packages/core`, then re-run `yarn install` at the root) before any release. After the rebuild:

- The two test-fixture defects fixed in Concerns 1-2 will be caught by `yarn lint` (eslint+typescript-eslint) and any future strict-tsc CI step.
- `tsc --noEmit -p packages/core/tsconfig.lint.json` should drop from ~30 errors to 0 (the rest of the listed errors are in other test files and are pre-existing — they reference missing exports like `AsyncEventHandler`, `Connectable`, `BrokerResilience`, `isConnectable` that were added on the live branch but not yet rebuilt into the symlinked dist).

This is environmental, not a defect in the change under audit.

---

## Files Changed by Auditor

- `specs/core/persistence/view-store.spec.md` — added `delete` to the "ViewStore accepts ID types for viewId" scenario.
- `specs/core/ddd/projection.spec.md` — added explicit return-type annotation on the async DeleteView reducer scenario.
- `packages/core/src/__tests__/persistence/view-store.test.ts` — added `delete` to matching test object literal.
- `packages/core/src/__tests__/ddd/projection.test.ts` — added explicit return-type annotation on async DeleteView reducer test.
- `docs/content/docs/read-model/view-persistence.mdx` — replaced the misleading "async reducers (`async () => DeleteView`) are supported" line with the actual TypeScript guidance plus the annotated example.

---

## Test Counts (post-Auditor edits)

| Suite                                                                               | Result                                                                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/core` full vitest                                                         | 279/279 PASS                                                                                   |
| `packages/engine` full vitest                                                       | 326/326 PASS (tracing suite fails to load due to optional `@opentelemetry/api` — pre-existing) |
| `packages/core/src/__tests__/persistence/view-store.test.ts`                        | 7/7 PASS                                                                                       |
| `packages/core/src/__tests__/ddd/projection.test.ts`                                | 37/37 PASS                                                                                     |
| `packages/engine/src/__tests__/engine/implementations/in-memory-view-store.test.ts` | 14/14 PASS                                                                                     |
| `packages/engine/src/__tests__/integration/projection-delete-view.test.ts`          | 3/3 PASS                                                                                       |

---

**Final verdict: PASS.** The implementation is correct, coherent, and well-documented. Two minor test-fixture defects were caught and fixed by the Auditor in this cycle. No behavioral spec violations; no Builder rework required.
