## Audit Report: per-saga `atomicity` configuration

- **Verdict**: PASS
- **Cycle**: 1
- **Specs**:
  - `specs/core/ddd/saga.spec.md` (new `SagaAtomicity` export + optional `atomicity?` field)
  - `specs/engine/executors/saga-executor.spec.md` (mode-branching behavior)

### Mechanical Checks

| Check               | Result | Details                                                                                                                               |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Export coverage     | PASS   | 14/14 spec exports present in `saga.ts` (`SagaAtomicity` added). Surfaces via `index.ts → ./ddd → ./saga`; present in built `dist`.   |
| Stubs remaining     | PASS   | 0 stubs (`throw new Error` grep empty). The `throw error` in `failCommitPhase` is a legitimate rollback re-throw, not a stub.         |
| Type check (core)   | PASS   | `tsc --noEmit` exit 0                                                                                                                 |
| Type check (engine) | PASS   | `tsc --noEmit` exit 0 (resolves `SagaAtomicity` from prebuilt `@noddde/core` dist)                                                    |
| Tests (core saga)   | PASS   | 35/35                                                                                                                                 |
| Tests (engine saga) | PASS   | saga-executor 12/12                                                                                                                   |
| Tests (full engine) | PASS   | 388/388 (39 files) — nothing downstream broke                                                                                         |
| Tests (CLI)         | PASS   | 191/191 (20 files) after template hint added                                                                                          |
| ESLint              | PASS   | `--max-warnings 0` clean on both sources, both test files, and the edited CLI template                                                |
| Invariants enforced | PASS   | 12/12 — type-level (`SagaAtomicity` union, optional field, `defineSaga` identity) + runtime (`saga.atomicity ?? "atomic"` mode split) |
| Edge cases covered  | PASS   | All 9 core + all atomicity engine edge cases handled; the 4 mode-specific ones have dedicated tests                                   |
| Prettier            | PASS   | `--check` clean on all 5 touched doc/CLI files                                                                                        |

### Coherence Review

- **Spec intent alignment**: Faithful — not a technicality pass. `const mode = saga.atomicity ?? "atomic"` (saga-executor.ts:137) realizes BR 7 exactly. The **atomic** branch (enlist → dispatch → commit → publish, all inside `uowStorage.run`) matches BRs 8–14; the **best-effort** branch (enlist → commit → publish inside `uowStorage.run`, then dispatch _outside_ it but inside `metadataStorage.run`) matches BRs 15–18. I cross-checked the mechanism against `CommandLifecycleExecutor` (`ownsUow = !this.uowStorage.getStore()`, line 100–121): placing command dispatch inside vs. outside `uowStorage.run` is precisely what flips the command executor between the explicit-enlist path (atomic, deferred publish) and the implicit-own-UoW path (best-effort, immediate per-command publish) — the exact behavior the spec relies on. The two issue #119 integration tests prove the observable difference end-to-end through the real `EventEmitterEventBus`.
- **Unhandled scenarios**: None. Steps 1–6 are shared across modes; all mode-specific edge cases (atomic rollback, best-effort persists-on-failure, best-effort commit-ordering, best-effort resumes #119, atomic drops #119) are covered by tests.
- **Convention compliance**: Compliant. `SagaAtomicity` is a clean string-literal union with JSDoc; `atomicity?` optional with thorough JSDoc; `defineSaga` stays a pure identity (the "never defaults" invariant holds — core reads the field nowhere; the engine supplies the default at execution time, and `defineSaga atomicity default` test asserts `undefined` + reference identity). No `console.*` (uses injected `Logger`). Naming (`SagaAtomicity`, `define*`, `Infer*`) consistent.
- **Breaking change propagation**: N/A. Additive optional field; absent → `atomic` preserves prior behavior. No `## Migration`/`## Deprecations` sections. Full engine suite (388/388) confirms no downstream breakage. Changesets correct: both `@noddde/core` and `@noddde/engine` as **minor** (additive), with accurate notes.

### Documentation

- **Pages updated**: 4
  - `docs/content/docs/process-managers/sagas.mdx` — new **Atomicity** section (mode table, declarative-field callout, "When to use best-effort", golden-path note, issue #119 link). Code snippet verified type-correct against the new API.
  - `docs/content/docs/design-decisions/why-sagas-return-commands.mdx` — refined the **Atomicity** subsection to reference the two modes; added a new **The Golden Path: Return Events, Don't Dispatch Them** section with a warn callout covering the off-path `eventBus.dispatch()` risk and the `best-effort` escape hatch (issue #119).
  - `docs/content/docs/testing/testing-sagas.mdx` — new **Atomicity Mode and testSaga** note clarifying that `atomicity` does not affect `testSaga` (handler-isolation harness); points to `testDomain` for mode-dependent behavior.
  - `docs/content/docs/running/persistence.mdx` — made the **Saga Unit of Work** section mode-aware (it previously described only atomic coupling, which became incomplete after this change). Not in the spec's `docs` mapping, but fixed to avoid doc staleness.
- **Pages created**: 0
- **API reference updated**: 0 — there is no dedicated API-reference page for sagas under `docs/content/docs/api/`; the API surface is documented inline in the conceptual pages above. `docs/public/llms.txt` already lists all three mapped pages with descriptions that remain accurate (no pages created/renamed/deleted), so no `llms.txt` edit was required.

### CLI Template

- `packages/cli/src/templates/saga/saga.ts` — added a commented `// atomicity: "best-effort",` hint with a two-line explanation inside the `defineSaga` config, matching the template's existing commented-TODO style. The scaffold still works without it (optional field, `atomic` default). CLI tests (191/191) and ESLint remain clean; the existing negative assertions (`.not.toContain("associations:")` / `"handlers:"`) are unaffected.

### Notes (non-blocking; pre-existing, NOT introduced by this change)

1. **Builder-flagged spec/test drift**: `specs/engine/executors/saga-executor.spec.md` contains a Test Scenario "saga handler failure is isolated from sibling subscribers" (a `wireDomain` integration test) that is absent from `saga-executor.test.ts`. Confirmed absent. It predates this change and is unrelated to atomicity. Worth a separate follow-up to either add the test or move the scenario, but not grounds to FAIL this change.
2. **Under-specified pre-existing core test**: in `packages/core/src/__tests__/ddd/saga.test.ts`, the `SagaEventHandler` block's "should receive infrastructure merged with CQRSInfrastructure" (lines 162–166) asserts only `MyInfra & CQRSInfrastructure`, omitting `FrameworkInfrastructure`, whereas the spec/source merge all three (saga.ts:122–124). It still compiles (the assertion is a structural subset that the type-checker accepts here) and the `InferSagaEventHandler` block (lines 379–384) tests the full three-way intersection correctly. Pre-existing, unrelated to atomicity; a minor cleanup candidate for a future pass.
