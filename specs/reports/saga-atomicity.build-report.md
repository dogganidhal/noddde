## Build Report: per-saga `atomicity` configuration

- **Specs**:
  - `specs/core/ddd/saga.spec.md` (new `SagaAtomicity` export + optional `atomicity?` field)
  - `specs/engine/executors/saga-executor.spec.md` (mode-branching behavior)
- **Sources**:
  - `packages/core/src/ddd/saga.ts`
  - `packages/engine/src/executors/saga-executor.ts`
- **Tests**:
  - `packages/core/src/__tests__/ddd/saga.test.ts` (+3 describe blocks / +5 `it`s, appended)
  - `packages/engine/src/__tests__/engine/executors/saga-executor.test.ts` (+4 `it`s, appended)
- **Result**: GREEN
- **Tests passing**: core 35/35; engine saga-executor 12/12; full engine suite 388/388 (39 files)
- **Loop count**: 1 (tests passed on first implementation; no RED→GREEN repair loops)
- **Changesets**: `.changeset/saga-atomicity-core.md` (`@noddde/core` minor), `.changeset/saga-atomicity-engine.md` (`@noddde/engine` minor)

### Implementation summary

- **Core**: added `export type SagaAtomicity = "atomic" | "best-effort"` and an optional `atomicity?: SagaAtomicity` field on the `Saga` interface, both with JSDoc. `defineSaga` is unchanged (pure identity — does not read/validate/default the field). Surfaces via `@noddde/core` through the existing `export * from "./saga"` barrel.
- **Engine**: `SagaExecutor.execute()` now resolves `const mode = saga.atomicity ?? "atomic"` and branches:
  - **atomic** (default) — unchanged: one UoW spans saga-state save + all reaction commands (enlist → dispatch → commit → publish), rollback-and-rethrow on failure.
  - **best-effort** — commit the saga-state UoW first (enlist → commit → publish), then dispatch reaction commands outside `uowStorage` but inside `metadataStorage` (each command gets its own UoW via `CommandLifecycleExecutor`). A post-commit command failure propagates without rolling back saga state. Reuses PR #120's reorder.
  - Shared helpers `commitAndPublish` / `dispatchCommands` / `failCommitPhase` keep both branches DRY; instrumentation (`withSpan`/`withExtractedContext`) and the `onEventsDispatched` callback are preserved in both.

### Test Results (new scenarios)

| Test                                                                                          | Status |
| --------------------------------------------------------------------------------------------- | ------ |
| core: Saga atomicity field › types SagaAtomicity as the union                                 | PASS   |
| core: Saga atomicity field › exposes atomicity as optional SagaAtomicity on Saga              | PASS   |
| core: defineSaga atomicity › preserves explicit best-effort                                   | PASS   |
| core: defineSaga atomicity › preserves explicit atomic                                        | PASS   |
| core: defineSaga atomicity default › omitted stays undefined (identity preserved)             | PASS   |
| engine: best-effort › persists saga state even when a command throws                          | PASS   |
| engine: best-effort (commit ordering) › state committed before command handler runs           | PASS   |
| engine: best-effort (issue #119) › resumes saga when command handler dispatches consumed evt  | PASS   |
| engine: atomic (issue #119 limitation) › drops command-handler-dispatched event (stays proc.) | PASS   |
| engine: (existing) rolls back UoW and not persist state when command throws — still PASS      | PASS   |

### Validation gates

- `tsc --noEmit`: core exit 0; engine exit 0 (engine type-check requires `@noddde/core` `dist` to be built first — turbo handles this in CI; built locally via `tsup` for verification).
- ESLint `--max-warnings 0` on all four touched files: exit 0.
- Prettier `--check`: all touched files clean.

### Concerns

1. **Pre-existing spec/test drift (NOT introduced here)**: `specs/engine/executors/saga-executor.spec.md` contains a Test Scenario "saga handler failure is isolated from sibling subscribers" (a `wireDomain` integration test using `domain.commandBus`) that is **absent** from the generated test file `saga-executor.test.ts`. It predates this change; I did not add it (it may not compile against the current `Domain` surface, which exposes buses via `domain.infrastructure`). Flagging for the Auditor — out of scope for this change, but worth a follow-up.
2. **Environment note for the Auditor**: this is a fresh worktree; `yarn`/`npx tsc` are unreliable here (mise yarn shim has no version; `~/.npmrc` needs `${CODEARTIFACT_AUTH_TOKEN}` which isn't in the sandbox shell). Run tooling via the hoisted binaries directly: `node_modules/.bin/tsc`, `node_modules/.bin/vitest`, `node_modules/.bin/eslint`. `@noddde/core` `dist` has already been built (`packages/core/dist`), so engine `tsc --noEmit` resolves the new types.

### Not done (Auditor's scope)

- Documentation updates (`docs/content/docs/process-managers/sagas.mdx`, `testing/testing-sagas.mdx`, `design-decisions/why-sagas-return-commands.mdx`).
- CLI saga-template assessment (`packages/cli/src/templates/saga/saga.ts`).
