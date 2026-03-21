---
name: generate-tests
description: "Internal procedure for Step 2. Use /spec instead — it orchestrates the full pipeline. This skill contains detailed instructions for generating vitest tests from a spec's Test Scenarios section."
user-invocable: false
model: sonnet
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Step 2: Generate Tests (RED Phase)

Create or update a vitest test file from a spec's `## Test Scenarios` section.

**Pipeline step 2 of 6.** Called by the `/spec` orchestrator after step 1 (spec creation/editing).

**Key principle**: Tests MUST be generated BEFORE the implementation. This proves the tests are meaningful — they fail when the behavior is missing and pass when it's present. If tests are generated alongside the implementation, you can't know if they'd catch regressions.

## Step 1: Find the Spec

If a spec path is provided, read it directly. Otherwise, find it:

- From a source file: replace `packages/core/src/` with `specs/core/` and `.ts` with `.spec.md`
- From a module name: look in `specs/core/<module-path>.spec.md`
- From a test file: reverse the mapping below

## Step 2: Read the Spec

Read the full spec. Focus on:

- `title` from frontmatter (used for `describe()` block name)
- `status` from frontmatter (must be `ready` or later — refuse to generate tests from `draft` specs)
- `## Test Scenarios` section (the source of truth for tests)
- `## Type Contract` (for understanding imports needed)
- `exports` from frontmatter (for import statements)

## Step 3: Determine Test File Path

| Spec path                          | Test file path                                           |
| ---------------------------------- | -------------------------------------------------------- |
| `specs/core/<path>/<name>.spec.md` | `packages/core/src/__tests__/<path>/<name>.test.ts`      |
| `specs/integration/<name>.spec.md` | `packages/core/src/__tests__/integration/<name>.test.ts` |

Create parent directories if they don't exist.

## Step 4: Generate the Test File

### Structure

```typescript
import { describe, it, expect, expectTypeOf } from "vitest";
import {} from /* exports from spec */ "@noddde/core";

describe("<spec title>", () => {
  // One it() block per ### heading in Test Scenarios
  it("<heading text>", async () => {
    // Code from the TypeScript code fence under that heading
  });
});
```

### Rules

- Each `### Heading` in `## Test Scenarios` → one `it()` block
- The heading text becomes the test name (lowercase, as-is)
- TypeScript code fences under each heading are the test body verbatim
- If a code fence has setup code (variable declarations, mock creation), include it inside the `it()` block
- Use `expectTypeOf` for compile-time type assertions
- Use `expect` for runtime value assertions
- If tests need shared setup, use `beforeEach` — but prefer self-contained tests
- Async tests: use `async () => { ... }` when the test body contains `await`

### Handling Existing Test Files

If the test file already exists:

1. Read it
2. Identify which test scenarios are new (in spec but not in test file)
3. Identify which test scenarios were modified (heading exists but code differs)
4. Add new tests, update modified tests, preserve any manually-added tests
5. Do NOT delete tests that exist in the file but not in the spec (they may be manually added)

## Step 5: Run Tests (expect RED)

Run the generated tests:

```bash
cd packages/core && CODEARTIFACT_AUTH_TOKEN="" npx vitest run --reporter=verbose <test-file-path>
```

**Expected outcomes at this stage:**

- **Tests that fail because the implementation is a stub or missing**: This is CORRECT. These are the RED tests that prove the spec is testable. Count them.
- **Tests that fail because of test code errors** (syntax, bad imports, wrong setup): These need fixing NOW. Fix the test code so it would pass if the implementation existed. The test code itself must be correct.
- **Tests that fail because the spec's test scenarios have bugs**: Flag for the developer, do NOT silently fix the spec.
- **Type-level tests (`expectTypeOf`)**: These may already pass if the type definitions exist. That's fine — type contracts are often complete before runtime behavior.

**Distinguish between**:

- Compilation failures → fix test code (bad imports, syntax)
- Runtime failures from stubs (`throw new Error("Not implemented")`) → expected RED, leave as-is
- Runtime failures from wrong assertions → fix test code

## Step 6: Summary

```
🔴 Tests generated (RED phase): <test-file-path>

From spec: <spec-path>
Test scenarios: <N> total
  - 🔴 <N> failing (expected — implementation not written yet)
  - ✅ <N> passing (type-level assertions or already-implemented behavior)
  - 🔧 <N> fixed (test code errors corrected)

The tests are intentionally RED. This confirms they will catch missing behavior.

Next step:
  Run `/implement-spec <spec-path>` to write the implementation and turn tests GREEN.
```
