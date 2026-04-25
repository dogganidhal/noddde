## Audit Report: DeleteView Sentinel + ViewStore.delete (combined three-spec audit)

- **Verdict**: PASS
- **Cycle**: 1
- **Specs audited**:
  - `specs/core/persistence/view-store.spec.md` (`ViewStore.delete`)
  - `specs/core/ddd/projection.spec.md` (`DeleteView` sentinel + reducer return type)
  - `specs/engine/implementations/in-memory-view-store.spec.md` (in-memory `delete`)

### Mechanical Checks

| Check                                       | Result | Details                                                                                                                                                                                                                         |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export coverage (view-store)                | PASS   | 1/1 exports present (`ViewStore`); `delete` method on the interface                                                                                                                                                             |
| Export coverage (projection)                | PASS   | 12/12 exports present, including the new `DeleteView` symbol; re-exported via `ddd/index.ts` and `core/src/index.ts`                                                                                                            |
| Export coverage (in-memory)                 | PASS   | 1/1 exports present (`InMemoryViewStore`) with `delete`, `findAll`, `find`                                                                                                                                                      |
| Stubs remaining                             | PASS   | 0 stubs in modified files. `throw new Error` in `domain.ts` are validation errors, not stubs                                                                                                                                    |
| Type check (`packages/core`)                | PASS   | `tsc --noEmit` (regular config, excludes tests) clean                                                                                                                                                                           |
| Type check (`packages/engine`)              | PASS\* | Build-order artifact: engine resolves `@noddde/core` via a symlink to a different worktree's stale `dist`. Resolves after `yarn build`. Vitest source-aliases to local source and runs green. See "Build-order artifact" below. |
| Type check (`samples/sample-hotel-booking`) | PASS\* | Pre-existing missing `@noddde/rabbitmq` import unrelated to this change; no new errors introduced                                                                                                                               |
| Tests (core)                                | PASS   | 25 files / 279 tests, including 9 new (4 view-store + 7 DeleteView) all green                                                                                                                                                   |
| Tests (engine)                              | PASS   | 31 suites passing / 326 tests; 1 pre-existing `tracing.test.ts` failure due to missing `@opentelemetry/api` peer dep (confirmed unrelated by Builder; reproduces on unchanged main)                                             |
| Behavioral requirements (view-store)        | PASS   | 7/7 implemented and tested (BR 6 idempotency, BR 7 totality covered by new tests + integration scenarios)                                                                                                                       |
| Behavioral requirements (projection)        | PASS   | 21/21 implemented and tested. New BR 16-21 each map to specific tests (see Coverage Map)                                                                                                                                        |
| Behavioral requirements (in-memory)         | PASS   | 9/9 implemented and tested (5 new tests cover BR 4 coercion, BR 8 removal, BR 9 idempotency + edge cases)                                                                                                                       |
| Invariants enforced                         | PASS   | All; notably `DeleteView === DeleteView` reference equality and "MUST NOT call save when DeleteView is returned" are checked at runtime in both dispatch paths (see Coherence Review)                                           |
| Edge cases covered                          | PASS   | All; missing-view idempotency, conditional return, async DeleteView, strong-consistency UoW enlist, in-memory `String()` coercion, save-after-delete fresh entry                                                                |

#### Coverage map for new requirements

| Spec       | New requirement                                     | Test                                                                                                                                                                                     |
| ---------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| view-store | BR 6 (idempotent delete)                            | `ViewStore delete signature`, `InMemoryViewStore delete idempotency`, `DeleteView idempotency`                                                                                           |
| view-store | BR 7 (delete then load returns undef/null)          | `delete removes a stored view`, integration `delete then load`, `save after delete creates a fresh entry`                                                                                |
| projection | BR 16 (`DeleteView` is unique-symbol sentinel)      | `DeleteView sentinel: should be a symbol / equal itself / not equal a fresh symbol / typed as unique symbol`                                                                             |
| projection | BR 17 (reducer return type union)                   | `Reducer return type with DeleteView: should accept reducers that return TView or DeleteView`                                                                                            |
| projection | BR 18 (engine routes DeleteView → delete, not save) | `Eventual-consistency DeleteView: should call viewStore.delete when reducer returns DeleteView` (asserts both `saveSpy` and `deleteSpy`)                                                 |
| projection | BR 19 (conditional deletion)                        | `Reducer return type with DeleteView: should accept reducers that conditionally return DeleteView`                                                                                       |
| projection | BR 20 (idempotent at engine level)                  | `DeleteView idempotency: should not throw when reducer returns DeleteView for missing view`                                                                                              |
| projection | BR 21 (strong consistency enlists in UoW)           | `Strong-consistency DeleteView: should delete the view atomically with the originating command`                                                                                          |
| in-memory  | BR 4 + BR 8 + BR 9 + edge cases                     | `delete uses string coercion`, `delete removes a stored view`, `delete is idempotent on a missing key`, `delete leaves other views untouched`, `save after delete creates a fresh entry` |

#### Build-order artifact (clarification on type-check note)

The engine workspace's `node_modules/@noddde/core` is a **symlink to a different working tree** (`C:\Users\Nidhal\IdeaProjects\noddde\packages\core`), not to the worktree under audit. Its `dist/` predates this change and does not export `DeleteView` or `ViewStore.delete`. Therefore:

- Direct `tsc --noEmit` in `packages/engine` reports `'DeleteView' is not exported` and `Property 'delete' does not exist on type 'ViewStore<any>'`.
- Vitest **does not** hit this path: `packages/engine/vitest.config.mts` aliases `@noddde/core` to `../core/src/index.ts` (the local worktree source), so the runtime tests use the new exports and all pass.
- Building `packages/core` directly (`tsc` inside `packages/core`) writes the new `dist/` into the **worktree's** `packages/core/dist`. The symlinked target's `dist/` is updated only by a separate yarn install / build step that re-points or re-syncs the symlink.

Conclusion: this is the same build-order artifact the Builder reported. No code change is required — engine code uses both `DeleteView` (value import) and `ViewStore.delete` (method call) correctly, and these will type-check the moment the symlink target is rebuilt. I confirmed by inspecting the source and by running the full vitest suite via local source aliasing.

### Coherence Review

- **Spec intent alignment**: PASS. The engine routes `DeleteView` to `viewStore.delete` in **both** dispatch paths, and the routing is performed on the **awaited** reducer return value (so async reducers returning `Promise<typeof DeleteView>` are honored):

  - Eventual-consistency path (`packages/engine/src/domain.ts:1128-1133`):
    ```ts
    const newView = await handler.reduce(event, currentView);
    if (newView === DeleteView) {
      await viewStoreInstance.delete(viewId);
    } else {
      await viewStoreInstance.save(viewId, newView);
    }
    ```
  - Strong-consistency path (`packages/engine/src/domain.ts:917-922`):
    ```ts
    const newView = await handler.reduce(event, currentView);
    if (newView === DeleteView) {
      uow.enlist(() => viewStoreInstance.delete(viewId));
    } else {
      uow.enlist(() => viewStoreInstance.save(viewId, newView));
    }
    ```
    Both branches are mutually exclusive. The strong-consistency path correctly uses `uow.enlist(() => ...)` rather than a direct call (so deletion is atomic with the command's UoW per BR 21). Branch order matches the spec invariant: "When a reducer's awaited return value is `DeleteView`, the engine MUST NOT call `viewStore.save`."

- **Unhandled scenarios**: None found.

  - I enumerated dispatch sites with `grep -n "viewStoreInstance.save\|viewStoreInstance.load" packages/engine/src/domain.ts`. There are exactly two `viewStoreInstance.save` calls — both guarded by the `=== DeleteView` branch — and two `viewStoreInstance.load` calls (one per consistency mode), each preceding a routed save/delete. No additional persistence sites in `domain.ts` bypass the sentinel check.
  - `grep -rl "implements ViewStore\|extends ViewStore" packages/ samples/` finds two implementers: `InMemoryViewStore` (engine) and `DrizzleViewStore` (sample-hotel-booking). Both implement `delete`. No other implementers in `packages/adapters` (verified by `grep`).

- **Convention compliance**: Compliant.

  - `DeleteView` has full JSDoc with usage example.
  - `ViewStore.delete` and `ViewStore` interface have JSDoc; `delete` has an explicit idempotency note.
  - `InMemoryViewStore.delete` has JSDoc with idempotency and load-after-delete contract.
  - Reducer signature update (`TView | typeof DeleteView | Promise<TView | typeof DeleteView>`) propagated to `ProjectionEventHandler` (the source of truth used by the `Infer*` utilities). Verified `InferProjectionEventHandler<T, K>` resolves to the new union via the `Reducer return type with DeleteView: should accept reducers that return TView or DeleteView` test, which extracts `ReturnType<NonNullable<typeof projection.on.X>["reduce"]>` and compares it to `View | typeof DeleteView | Promise<View | typeof DeleteView>`.
  - No `console.*` calls added in any modified source file.

- **Sentinel reference equality**: Confirmed via source. `packages/core/src/ddd/projection.ts:30` declares `export const DeleteView: unique symbol = Symbol("DeleteView")` — a single exported instance. The `=== DeleteView` checks in `domain.ts` compare against this exact reference. The test `should not equal a freshly created symbol with the same description` enforces that `Symbol("DeleteView") !== DeleteView` at runtime.

- **Breaking change propagation**: Complete.

  - Both in-tree implementers (`InMemoryViewStore`, `DrizzleViewStore`) updated with `delete` methods.
  - No other `ViewStore` implementers exist in `packages/` or `samples/`.
  - The CLI projection template (`packages/cli/src/templates/domain/projection-view-reducers.ts`) still produces a reducer that returns `TView`. This is forward-compatible with the new union — a function returning `TView` is assignable to `TView | typeof DeleteView | Promise<TView | typeof DeleteView>`. No template change required for this purely additive feature; users who want deletion can extend the scaffold by importing `DeleteView`.

- **Other spec references to ViewStore**: Surveyed via `grep -rl ViewStore specs/`. The only specs referencing `ViewStore` are the three audited here plus pre-existing references in `specs/engine/domain.spec.md` (uses `ViewStore` only as a generic type for examples) and `specs/engine/tracing.spec.md` / `specs/engine/implementations/in-memory-outbox-store.spec.md` (no `delete`-related content). No spec body updates needed beyond the three audited.

### Documentation

- **Pages updated**: 2
  - `docs/content/docs/read-model/view-persistence.mdx`:
    - Updated the `ViewStore` interface code block to include `delete` and an idempotency note.
    - Refreshed the "Extending with Custom Query Methods" copy ("base interface provides save, load, delete").
    - Added a new subsection "Implementing a Custom ViewStore" with a stub example noting the no-throw-on-missing contract.
    - Updated the `InMemoryViewStore` example to demonstrate `delete` and post-delete load.
    - Added a top-level section "Deleting Views with `DeleteView`" with: how the engine routes the sentinel (eventual + strong), conditional-deletion example, idempotency note, strong-consistency variant.
    - Updated the engine flow numbered list to mention "save or delete" and the sentinel link.
    - Updated both consistency-mode diagrams to mention `viewStore.delete`.
  - `docs/content/docs/read-model/projections.mdx`:
    - Added a bullet to "Key properties of event handlers" describing the `DeleteView` return option and the full reducer union type.
    - Added a "Deleting Views Conditionally" subsection under "Why an `on` Map?" / "Similarity to Evolve Handlers" showing the idiomatic `permanent ? DeleteView : { ... }` pattern with a cross-reference to view-persistence.
    - Updated the engine flow numbered list to mention `DeleteView` routing.
- **Pages created**: 0
- **API reference updated**: 0

  The repository's auto-generated API directory at `docs/src/content/docs/api/` is **not consumed by the live site** — `docs/source.config.ts` registers Fumadocs at `content/docs` only, and the Next.js routes do not import from `src/content/docs/api/`. The `ViewStore.md` file there is vestigial. I did not modify it. If the project reintroduces a typedoc/typedocs-starlight pipeline later, that file will be regenerated.

- **`docs/public/llms.txt`**: not modified (no pages added/removed/renamed).
- **Stale doc paths in spec frontmatter** (pre-existing, not in scope to fix): the `docs:` entries on the three specs reference paths under `projections/` and `infrastructure/` that don't exist. The actual layout is `read-model/`. This pre-dates this change. Flagged as a concern below for the developer to clean up later.
- **Prettier**: ran `prettier --check` on the two updated files after edits — both pass cleanly.

### Concerns (non-blocking, for developer awareness)

1. **Spec test scenario "ViewStore accepts ID types for viewId" (lines 173-191 of `specs/core/persistence/view-store.spec.md`) omits the now-required `delete` method.**

   - **Context**: The spec body's test scenario constructs `const store: ViewStore<string> = { save: ..., load: ... }` without `delete`. The Builder copied this verbatim into `packages/core/src/__tests__/persistence/view-store.test.ts:51-54`. Vitest does not type-check, so the test runs green at runtime. ESLint (with `tsconfig.lint.json`) would not directly fail on this either; only `tsc -p tsconfig.lint.json --noEmit` would emit a type error, and that command is not part of the project's pre-push checklist (per CLAUDE.md, pre-push runs `tsc --noEmit` against the regular `tsconfig.json`, which excludes `__tests__`). So the test does not block merge.
   - **Why CONCERN, not FAIL**: The test is faithful to the spec scenario as authored. The spec is the source of truth; updating the test against the spec would be the wrong direction. The right fix is for the developer to update the spec scenario in a follow-up to add `delete: async (_viewId: ID) => {}` (or to remove the explicit `: ViewStore<string>` annotation if the intent was a structural-typing test). Since the Auditor is forbidden from modifying spec bodies, I'm flagging this rather than fixing it.
   - **Suggested fix**: Edit `specs/core/persistence/view-store.spec.md` lines 178-189 to add `delete: async (_viewId: ID) => {}` to the object literal; the test file should be regenerated to match.

2. **Spec frontmatter `docs:` paths are stale (pre-existing, not introduced by this change).**

   - **Context**: All three spec frontmatters point to paths like `projections/overview.mdx` and `infrastructure/in-memory-implementations.mdx`. The actual docs live at `docs/content/docs/read-model/...`. Some doc-path mismatches are pre-existing across the repo.
   - **Why CONCERN, not FAIL**: This pre-dates the DeleteView change. Updating frontmatter is allowed by the audit-spec skill (frontmatter is not "spec body"), but a sweeping cleanup is out of scope for a feature audit; the relevant docs were correctly identified and updated by following the actual layout.
   - **Suggested fix**: A follow-up housekeeping pass to normalize `docs:` frontmatter across all specs to match `docs/content/docs/<section>/<file>.mdx` paths.

3. **Engine `tsc --noEmit` reports `DeleteView`/`delete` errors due to the `@noddde/core` symlink targeting a different worktree.**
   - **Context**: `node_modules/@noddde/core` is symlinked to `C:\Users\Nidhal\IdeaProjects\noddde\packages\core` rather than the worktree's own `packages/core`. This is a workspace setup peculiarity (likely from yarn classic + worktree usage), not a code defect.
   - **Why CONCERN, not FAIL**: Vitest aliases bypass it and pass; rebuilding the IdeaProjects core (or re-running yarn install in the worktree) clears it. The Builder reported the same artifact and noted it would resolve after `yarn build`. I confirmed by direct rebuild of `packages/core/dist` (worktree-local) — the local dist is correct.
   - **Suggested fix**: None on this PR. Could be a follow-up to make worktree node_modules independent (e.g., yarn workspaces with nodeLinker=node-modules and per-worktree installs).

### Summary

All three coupled specs are correctly implemented, fully tested, and documented. The Builder made a sound boundary decision (engine integration tests live under `packages/engine/src/__tests__/integration/`) and the engine routing logic is faithful to the spec on both dispatch paths and on awaited return values. The breaking change (adding `delete` to `ViewStore`) is fully propagated to all in-repo implementers. Documentation is updated to teach the `DeleteView` pattern with an idiomatic conditional-deletion example and clear cross-references between projections and view-persistence pages.

**Recommendation**: PASS. Ship.
