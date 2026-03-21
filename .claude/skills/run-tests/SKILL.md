---
name: run-tests
description: "Internal procedure for Step 4. Use /spec instead — it orchestrates the full pipeline. This skill contains detailed instructions for running tests and reporting RED/GREEN status."
user-invocable: false
model: sonnet
allowed-tools: Read, Glob, Grep, Bash
---

# Step 4: Run Tests (GREEN Phase)

Run the test suite and report whether the RED tests from step 2 are now GREEN.

**Pipeline step 4 of 6.** Called by the `/spec` orchestrator after step 3 (implementation). Loops back to step 3 if tests are RED.

## Step 1: Determine What to Run

**If a spec path is provided**: Find the corresponding test file:

- `specs/core/<path>/<name>.spec.md` → `packages/core/src/__tests__/<path>/<name>.test.ts`
- `specs/integration/<name>.spec.md` → `packages/core/src/__tests__/integration/<name>.test.ts`

**If a module name is provided**: Find test files matching:

- `packages/core/src/__tests__/**/<module-name>*.test.ts`

**If nothing is provided**: Run the full test suite.

## Step 2: Run Type Check

```bash
cd packages/core && npx tsc --noEmit
```

Report any type errors. Type errors must be fixed before tests can meaningfully pass.

## Step 3: Run Tests

**For a specific test file:**

```bash
cd packages/core && CODEARTIFACT_AUTH_TOKEN="" npx vitest run --reporter=verbose <test-file-path>
```

**For the full suite:**

```bash
cd packages/core && CODEARTIFACT_AUTH_TOKEN="" npx vitest run --reporter=verbose
```

## Step 4: Analyze Results

Categorize the outcome:

### All GREEN

Every test passes. The implementation matches the spec.

```
✅ All tests GREEN: <test-file-path>

Type check: ✅ passing
Tests: <N>/<N> passing

Next step:
  Run `/validate-spec <spec-path>` for the final cross-check.
```

### Some RED

Some tests still fail. The implementation is incomplete or incorrect.

```
🔴 Some tests still RED: <test-file-path>

Type check: ✅ passing / ❌ N errors
Tests: <passing>/<total> passing, <failing> failing

Failing tests:
  1. "<test name>" — <error message summary>
  2. "<test name>" — <error message summary>

Analysis:
  - <for each failure, identify whether it's a missing implementation,
    a bug in the implementation, or a test code issue>

Next step:
  Fix the implementation and run `/run-tests <spec-path>` again.
  If a test itself is wrong, update the spec first via `/edit-spec`.
```

### Compilation Failure

Tests can't even run due to TypeScript errors.

```
❌ Tests cannot run: compilation errors

Errors:
  <list type errors>

Next step:
  Fix type errors in the implementation, then run `/run-tests` again.
  Do NOT fix type errors by changing tests — the spec's type contract is the authority.
```

## Step 5: Update Spec Status (if all GREEN)

If ALL tests pass and type checking passes:

- Read the spec and update `status: implemented`
- Confirm to the developer:

```
✅ Spec status updated to `implemented`: <spec-path>

The full RED → GREEN cycle is complete.
Run `/validate-spec <spec-path>` for the final audit if desired.
```
