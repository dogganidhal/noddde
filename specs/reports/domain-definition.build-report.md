# Build Report: DomainDefinition & defineDomain — Move to @noddde/core

**Date**: 2026-05-19
**Builder**: Claude Sonnet 4.6
**Spec**: `specs/core/ddd/domain-definition.spec.md`
**Status**: GREEN

---

## Summary

This is a structural **move**, not new greenfield work. `DomainDefinition` and `defineDomain` (both overloads) were extracted from `packages/engine/src/domain.ts` into a new canonical module `packages/core/src/ddd/domain-definition.ts`. The engine re-exports both from core so all existing `import { defineDomain } from "@noddde/engine"` call sites continue to work without modification.

The `vitest.config.mts` for the core package was updated to alias `@noddde/engine` → the engine source tree, enabling the re-export reference-equality test to pass within the core test suite.

---

## Files Changed

### New Files

- `packages/core/src/ddd/domain-definition.ts` — `DomainDefinition` type, `defineDomain` function (both overloads + implementation), and three file-private helper types (`StandaloneCommandHandlerMap`, `StandaloneQueryHandlerMap`, `StandaloneEventHandlerMap`)
- `packages/core/src/__tests__/ddd/domain-definition.test.ts` — 8 vitest tests covering all 4 spec scenarios

### Modified Files

- `packages/core/src/ddd/index.ts` — added `export * from "./domain-definition";`
- `packages/core/vitest.config.mts` — added `@noddde/engine` alias pointing to engine source so cross-package reference-equality test works
- `packages/engine/src/domain.ts`:
  - Removed: `DomainDefinition` type, `defineDomain` function (both overloads + implementation), `StandaloneCommandHandlerMap`, `StandaloneQueryHandlerMap`, `StandaloneEventHandlerMap` local type aliases
  - Added: `import { defineDomain } from "@noddde/core"` and `import type { DomainDefinition } from "@noddde/core"`
  - Added: `export { defineDomain } from "@noddde/core"` and `export type { DomainDefinition } from "@noddde/core"` (backward-compat re-exports)
  - Retained: file-private `StandaloneCommandHandlerMap` and `StandaloneQueryHandlerMap` aliases used by `ExtractStandaloneCommand` / `ExtractStandaloneQuery` internal inference utilities

---

## Step 2: Tests Generated (RED)

8 tests generated from spec, grouped into 4 `describe` blocks:

| Scenario heading                                            | Tests | Initial state |
| ----------------------------------------------------------- | ----- | ------------- |
| defineDomain (core)                                         | 4     | RED           |
| defineDomain (core) — legacy overload                       | 1     | RED           |
| defineDomain (core) — processModel                          | 2     | RED           |
| defineDomain re-export from @noddde/engine                  | 1     | RED (module resolution issue) |

The re-export test required adding `@noddde/engine` to the core vitest alias config to resolve correctly (without the alias, the test compared source vs. built-dist function instances, which are different objects).

---

## Step 3: Implementation

### Core: `packages/core/src/ddd/domain-definition.ts`

- Three file-private mapped types (`StandaloneCommandHandlerMap`, `StandaloneQueryHandlerMap`, `StandaloneEventHandlerMap`) — identical to the originals in engine but now living in core
- `DomainDefinition<...>` with inline `Record<string | symbol, Aggregate<any>>` / `Record<string | symbol, Projection<any>>` constraints (not `AggregateMap`/`ProjectionMap` aliases — those remain engine-private)
- `defineDomain` — two overloads (preferred infer-everything + deprecated explicit-generics), implementation `(definition) => definition`

### Engine: `packages/engine/src/domain.ts`

- Removed the three local handler-map types and the full `DomainDefinition` + `defineDomain` block
- Added file-private `StandaloneCommandHandlerMap` and `StandaloneQueryHandlerMap` aliases (used by the engine-internal `ExtractStandaloneCommand` / `ExtractStandaloneQuery` infer utilities in `wireDomain`)
- Added value + type re-exports from core for backward compatibility

---

## Step 4: Test Results

### Core Package

```
Test Files  27 passed (27)
Tests       301 passed (301)
Duration    1.07s
```

Including 8 new domain-definition tests. `tsc --noEmit` clean.

### Engine Package

```
Test Files  34 passed (34)
Tests       345 passed (345)
Duration    1.66s
```

All existing engine tests continue to pass via the re-export. `tsc --noEmit` clean.

### Prettier + Lint

- Prettier: applied to all changed files, no remaining diffs
- `yarn lint` (Turborepo, 14 packages): 14 successful, 0 warnings

---

## Requirements Coverage

| Requirement                                              | Covered |
| -------------------------------------------------------- | ------- |
| defineDomain returns same object reference (identity)    | YES     |
| defineDomain is sync, no side effects                    | YES     |
| Overload 1: T inferred, narrow types preserved           | YES     |
| Overload 2: deprecated, explicit generics, typed handler | YES     |
| processModel optional; omission vs. {} both valid        | YES     |
| processModel.sagas omitted + standaloneEventHandlers set | YES     |
| @noddde/engine re-exports defineDomain (same reference)  | YES     |
| File-private helper types not exported                   | YES (no public exports for handler-map types) |
| Empty aggregates/projections maps valid                  | YES     |

---

## Notes for Auditor

- `AggregateMap`, `ProjectionMap`, `SagaMap` remain file-private in engine — they are referenced by `DomainWiring`, `ExtractAggregates`, `ExtractProjections`, `ExtractSagas`, and `wireDomain`. Exporting them from core is explicitly out-of-scope per the task instructions.
- The `defineDomain` import in engine (`import { defineDomain } from "@noddde/core"`) appears in the imports block but is only used for the re-export. ESLint `no-unused-vars` is suppressed at the top of the file (pre-existing `/* eslint-disable no-unused-vars */`).
- No CLI template changes needed — the `defineDomain` import path in templates is a downstream decision; the re-export from engine keeps all existing templates valid.
- `packages/core/vitest.config.mts` now aliases `@noddde/engine` — this is intentional and necessary so the re-export test can verify function reference identity without relying on built dist files.
