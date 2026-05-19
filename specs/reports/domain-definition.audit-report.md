## Audit Report: DomainDefinition & defineDomain — Move to @noddde/core

- **Verdict**: PASS
- **Cycle**: 1
- **Spec**: `specs/core/ddd/domain-definition.spec.md`
- **Build Report**: `specs/reports/domain-definition.build-report.md`

### Mechanical Checks

| Check                     | Result | Details                                                                                                                                                                 |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export coverage           | PASS   | 2/2 exports present (`DomainDefinition`, `defineDomain`); both reachable from `@noddde/core`.                                                                           |
| Stubs remaining           | PASS   | 0 stubs in `packages/core/src/ddd/domain-definition.ts`.                                                                                                                |
| Type check (core)         | PASS   | `npx tsc --noEmit` clean.                                                                                                                                               |
| Type check (engine)       | PASS   | `npx tsc --noEmit` clean.                                                                                                                                               |
| Tests (core)              | PASS   | 27/27 test files, 301/301 tests passing (incl. 8 new domain-definition tests).                                                                                          |
| Tests (engine)            | PASS   | 34/34 test files, 345/345 tests passing.                                                                                                                                |
| Tests (CLI)               | PASS   | 20/20 test files, 191/191 tests passing — template now imports from `@noddde/core`.                                                                                     |
| Tests (sample-flash-sale) | PASS   | 6/6 test files, 27/27 tests passing.                                                                                                                                    |
| Lint                      | PASS   | `yarn lint` zero warnings across all 14 packages.                                                                                                                       |
| Re-export check           | PASS   | Engine source re-exports both `defineDomain` and `DomainDefinition` from `@noddde/core`.                                                                                |
| Reference-equality        | PASS   | Verified in production builds via dist (`require('@noddde/engine').defineDomain === require('@noddde/core').defineDomain`); the vitest alias is consistent with this.   |
| Sample compatibility      | PASS   | `samples/sample-flash-sale` tsc + tests pass without any sample code change.                                                                                            |
| Invariants enforced       | PASS   | Identity (reference equality) + sync + pure-no-side-effects all verified by tests.                                                                                      |
| Edge cases covered        | PASS   | Empty maps, `processModel` omitted vs `{}`, sagas omitted + standaloneEventHandlers, fresh-reference-per-call.                                                          |
| Prettier (touched src)    | PASS   | LF/CRLF differences are a Windows-local working-copy artifact (`core.autocrlf=true`); Git stores LF, so CI sees LF and prettier passes. Confirmed via `git show :file`. |

### Coherence Review

- **Spec intent alignment**: Implementation faithfully reflects the spec's behavioral requirements. `defineDomain` is a single-line identity function `(definition) => definition` with two typed overloads; the `DomainDefinition` shape matches the spec's Type Contract field-for-field. The legacy overload is correctly marked `@deprecated` with a guiding JSDoc.
- **Unhandled scenarios**: None. All 8 spec scenarios are covered; the four edge-case branches all have either dedicated tests or are covered by passing the same input shape variations through the identity function.
- **Convention compliance**: Compliant — functional (no classes), JSDoc on `DomainDefinition` and both `defineDomain` overloads, no `console.*`, naming conventions followed (`Define*` identity function pattern matches `defineAggregate`/`defineProjection`/`defineSaga`).
- **Breaking change propagation**: N/A — this is an additive move. Engine still re-exports both names so all 26 docs pages and the 16 sample files importing `defineDomain` from `@noddde/engine` keep compiling. Build report confirms 14 packages still lint clean and all sample/test suites pass without modification.
- **Engine spec cross-references**: The engine spec (`specs/engine/domain.spec.md`) now references the core spec at every section where it would otherwise duplicate content (Type Contract block comment, prose discussion below the contract, Behavioral Requirements section header, Invariants, Edge Cases, Test Scenarios preface). No orphan claims about `defineDomain` remain in the engine spec.
- **File-private helper types**: The three handler-map types (`StandaloneCommandHandlerMap`, `StandaloneQueryHandlerMap`, `StandaloneEventHandlerMap`) are correctly file-private in the new core module (not exported). The engine retains its own private copies of two of them for internal `ExtractStandaloneCommand`/`ExtractStandaloneQuery` inference — they don't conflict because neither is exported from either package, and the two copies are structurally identical, so the engine's inference utilities work the same way regardless of whether they introspect a `DomainDefinition` originating from core or engine.
- **vitest alias note**: `packages/core/vitest.config.mts` adds `@noddde/engine` → engine source so the re-export reference-equality test resolves at test time. This is a test-config concern only — the property `engineDefineDomain === coreDefineDomain` holds in production too because the engine's runtime export is `export { defineDomain } from "@noddde/core"`, which becomes a live binding in the compiled JS (verified via dist builds: `require('@noddde/engine').defineDomain === require('@noddde/core').defineDomain` returns `true`).

### Documentation

- **Pages updated**: 6
  - `docs/content/docs/getting-started/quick-start.mdx` — split import: `defineDomain` from `@noddde/core`, `wireDomain` from `@noddde/engine`; updated descriptive paragraph to note canonical location + back-compat.
  - `docs/content/docs/running/domain-configuration.mdx` — updated `defineDomain` import path to `@noddde/core` (intro section + Complete Example); added one-line note that it lives in core and is re-exported from engine for back-compat.
  - `docs/content/docs/core-concepts/cqrs-and-event-sourcing.mdx` — split import to show the new canonical location.
  - `docs/content/docs/modeling/routing-and-dispatch.mdx` — split import similarly.
  - `packages/engine/README.md` — clarified "What's Inside" bullet: `wireDomain` is the engine's domain-orchestration export; `defineDomain` lives in `@noddde/core` and is re-exported here.
  - `packages/core/README.md` — added a bullet for `defineDomain` under "What's Inside".
- **Pages created**: 2
  - `docs/src/content/docs/api/functions/defineDomain.md` — new function API reference, modeled after `defineAggregate.md`.
  - `docs/src/content/docs/api/type-aliases/DomainDefinition.md` — new type-alias API reference covering all 6 type parameters and the writeModel/readModel/processModel structure.
- **API reference index updated**: `docs/src/content/docs/api/README.md` — added `defineDomain` under Functions and `DomainDefinition` under Type Aliases (alphabetically positioned).
- **CLI template updated**: `packages/cli/src/templates/domain/domain-wiring.ts` — `domainDefinitionTemplate` now generates `import { defineDomain } from "@noddde/core"` so newly scaffolded domains follow the canonical import path. CLI tests still pass (191/191) — the test asserts the symbol is present in output, not its import path.
- **Pages intentionally not updated**: 22 of 26 `defineDomain`-mentioning docs pages were left alone (low-traffic guides, pattern walkthroughs, testing references, persistence-adapter examples). Per the task calibration ("Update at most the high-traffic pages — don't churn every example"), updates focused on the introductory + canonical pages that readers hit first (quick-start, domain-configuration, CQRS, routing-and-dispatch). The remaining pages continue to work via the engine re-export.
- **JSDoc examples in adapter packages**: `packages/adapters/{typeorm,prisma,drizzle}/src/index.ts` JSDoc examples still show `import { defineDomain, wireDomain } from "@noddde/engine"`. Skipped per the task calibration (low-priority text updates, technically still correct).
- **llms.txt**: No structural changes needed — no pages were added, removed, or renamed in `docs/content/docs/`.
