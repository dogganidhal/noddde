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
  1. ✅ "CommandHandlerMap requires one handler per command name" — enforced via mapped type, tested
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
  🔧 "Async command handler" — handled, but no async test
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
cd packages/core && CODEARTIFACT_AUTH_TOKEN="" npx vitest run --reporter=verbose <test-file>
```

```bash
cd packages/core && npx tsc --noEmit
```

## Step 7.5: Documentation Staleness Check

If the spec has a `docs` frontmatter field, check documentation coverage:

1. Read each listed documentation page
2. For each page, find code blocks that import from `@noddde/core` and reference the spec's exports
3. Check if those code examples still match the current API signatures
4. Report any stale documentation:

```
Documentation Coverage:
  Pages listed in spec: <N>
  Pages with stale code examples: <N>
    - <page-path> (uses old signature for <export>)
  Pages discovered via grep but not in spec: <N>
```

This is a **warning**, not a hard failure — documentation updates happen in step 6.

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

  - PASS:    100% coverage, all tests green, no stubs → spec status stays `implemented`
  - PARTIAL: >80% coverage, tests green, minor gaps → flag gaps, spec status stays `implemented` with notes
  - FAIL:    Critical gaps, test failures, or stubs remain → spec status reset to `implementing`
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
