---
name: validate-spec
description: "Internal procedure for Step 5. Use /spec instead — it orchestrates the full 6-step pipeline. This skill contains detailed instructions for validating implementation against spec."
user-invocable: false
model: opus
allowed-tools: Read, Glob, Grep, Bash, Agent
---

# Step 5: Validate Spec Against Implementation

Final cross-check: verify the implementation fully satisfies the spec, beyond just passing tests.

**Pipeline step 5 of 6.** Called by the `/spec` orchestrator after step 4 (tests GREEN).

**Why this step exists**: Tests can pass while the implementation still drifts from the spec — missing exports, unenforced invariants, unhandled edge cases, leftover stubs. This step catches that.

## Step 1: Find Spec and Source

Accept either a spec path or source file path:

- Spec → source: read `source_file` from frontmatter
- Source → spec: replace `packages/core/src/` with `specs/core/`, `.ts` with `.spec.md`

Read both files completely. Also read the test file.

## Step 2: Export Coverage

Compare the spec's `exports` frontmatter against the source file's actual exports.

```
Export Coverage:
  ✅ AggregateTypes — exported in source
  ✅ defineAggregate — exported in source
  ❌ InferAggregateID — listed in spec but NOT exported in source
  ⚠️  HelperUtil — exported in source but NOT listed in spec
```

Flags:

- ❌ = spec promises this export but it's missing → implementation gap
- ⚠️ = source exports something the spec doesn't mention → spec may be incomplete, or export is internal

## Step 3: Behavioral Requirement Audit

For each numbered behavioral requirement in `## Behavioral Requirements`:

1. Read the requirement
2. Search the source file for the implementation
3. Check if a corresponding test exists in the test file
4. Grade: ✅ (implemented + tested) | 🔧 (implemented, not tested) | ❌ (not implemented)

```
Behavioral Requirements:
  1. ✅ "DecideHandlerMap requires one handler per command name" — enforced via mapped type, tested
  2. ✅ "defineAggregate is a pass-through identity function" — implemented, tested
  3. ❌ "Command handler returns single event normalized to array" — stub in source
```

## Step 4: Invariant Check

For each invariant in `## Invariants`:

1. Check if it's enforced by the type system (compile-time) or runtime check
2. Check if there's a test that would catch a violation

```
Invariants:
  ✅ "commands map has exactly one key per command name" — enforced by mapped type
  ✅ "apply map has exactly one key per event name" — enforced by mapped type
  ❌ "initialState is never mutated" — no runtime freeze, no test for mutation
```

## Step 5: Edge Case Coverage

For each edge case in `## Edge Cases`:

1. Check if the implementation handles it
2. Check if there's a test for it

```
Edge Cases:
  ✅ "Command handler returns empty array" — handled, tested
  ❌ "Command handler throws" — no error handling in dispatch
  🔧 "Async decide handler" — handled, but no async test
```

## Step 6: Stub Check

Search for remaining stubs in the source file:

```bash
grep -n "throw new Error" <source-file>
```

Any `Not implemented` stubs are a hard failure.

## Step 7: Test Execution (confirmation)

Run the tests one final time to confirm:

```bash
cd packages/core && npx vitest run --reporter=verbose <test-file>
```

```bash
cd packages/core && npx tsc --noEmit
```

## Step 7.5: Documentation Staleness Check

Check both conceptual docs and API reference pages for staleness.

### 7.5a: Conceptual documentation pages

If the spec has a `docs` frontmatter field:

1. Read each listed documentation page
2. For each page, find code blocks that import from `@noddde/core` and reference the spec's exports
3. Check if those code examples still match the current API signatures

### 7.5b: API reference pages

Search for API reference pages matching the spec's exports:

```bash
grep -rl "ExportName1\|ExportName2" docs/src/content/docs/api/ --include="*.md"
```

For each matching page:

1. Check that documented properties/methods match the actual source interface
2. Check that parameter types match (e.g., `string` vs `ID`)
3. Check that all interface fields are documented (no missing fields)
4. Check that no removed fields are still documented

### 7.5c: Missing API reference pages

For each export in the spec's `exports` list, check if a corresponding API reference page exists:

```bash
ls docs/src/content/docs/api/interfaces/<ExportName>.md
ls docs/src/content/docs/api/type-aliases/<ExportName>.md
ls docs/src/content/docs/api/classes/<ExportName>.md
ls docs/src/content/docs/api/functions/<ExportName>.md
```

Flag any exported types/interfaces/functions that have no API reference page.

### 7.5d: Report

```
Documentation Coverage:
  Conceptual pages listed in spec: <N>
  Conceptual pages with stale code examples: <N>
    - <page-path> (uses old signature for <export>)
  API reference pages checked: <N>
  API reference pages with stale content: <N>
    - <page-path> (<description of mismatch>)
  Missing API reference pages: <N>
    - <ExportName> (no docs/src/content/docs/api/**/<ExportName>.md found)
```

Stale documentation is a **hard failure** — the spec cannot be marked as `implemented` with stale docs. Step 6 (Update Documentation) will fix them, but this step must flag every instance so none are missed.

## Step 8: Validation Report

```
## Validation Report: <spec title>

Spec: <spec-path>
Source: <source-file>
Tests: <test-file>

### Coverage

| Category | Covered | Total | % |
|----------|---------|-------|---|
| Exports | 5 | 5 | 100% |
| Behavioral requirements | 9 | 9 | 100% |
| Invariants | 3 | 4 | 75% |
| Edge cases | 4 | 5 | 80% |
| Test scenarios | 8 | 8 | 100% |

### Issues Found

1. ❌ Invariant: "initialState never mutated" — no runtime freeze, no test for mutation
2. ❌ Edge case: "Command handler throws" — no error handling in dispatch

### Type Check: ✅ passing
### Test Suite: ✅ 8/8 passing
### Remaining Stubs: none

### Verdict: PASS | PARTIAL | FAIL

  - PASS:    100% coverage, all tests green, no stubs, docs up to date → spec status stays `implemented`
  - PARTIAL: >80% coverage, tests green, minor gaps, no stale docs → flag gaps, spec status stays `implemented` with notes
  - FAIL:    Critical gaps, test failures, stubs remain, OR stale/missing documentation → spec status reset to `implementing`

Documentation staleness (stale code examples, missing API reference pages, outdated property lists) counts as FAIL — step 6 will fix them before the pipeline can complete.
```

### If FAIL

```
Action required:
  1. <list specific items to fix>
  2. After fixing, run `/run-tests <spec-path>` then `/validate-spec <spec-path>` again
```

### If PASS

```
✅ Spec fully validated: <spec-path>

The 6-step pipeline continues:
  1. ✅ Spec written
  2. ✅ Tests generated (were RED)
  3. ✅ Implementation written
  4. ✅ Tests GREEN
  5. ✅ Validation PASS
  → 6. Update documentation (next step)
```
