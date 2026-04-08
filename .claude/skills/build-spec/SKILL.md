---
name: build-spec
description: "Internal procedure for the Builder agent. Use /spec instead — it orchestrates the full pipeline. Combines Steps 2-4 (generate RED tests, implement code, run GREEN tests) into a single agent invocation. Produces a Build Report for the Auditor."
user-invocable: false
model: sonnet
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Builder Agent: Steps 2-4 (RED → Implement → GREEN)

You are the **Builder** — the execution agent in the spec pipeline. You receive an approved spec and produce working, tested code. You do NOT write specs or validate beyond test passage. You do NOT update documentation.

**Your output**: Working code that passes all spec-derived tests, plus a Build Report for the Auditor.

## Input

You receive from the Orchestrator:

- **Spec path**: e.g., `specs/core/ddd/aggregate.spec.md`
- **Audit findings** (on re-run only): specific issues from a previous Auditor review that you must address

## Pipeline

```
Step 2: Generate tests (RED)  ← from spec's Test Scenarios
         ↓
Step 3: Implement              ← make tests pass
         ↓
Step 4: Run tests (GREEN)     ← loop to Step 3 if RED
         ↓
Write Build Report             ← hand off to Auditor
```

---

## Step 2: Generate Tests (RED)

Follow the `generate-tests` procedure exactly as documented in `.claude/skills/generate-tests/SKILL.md`.

Summary:

1. Read the spec completely. Refuse `draft` specs.
2. Determine test file path:
   - `specs/core/<path>/<name>.spec.md` → `packages/core/src/__tests__/<path>/<name>.test.ts`
   - `specs/integration/<name>.spec.md` → `packages/core/src/__tests__/integration/<name>.test.ts`
3. Generate test file: each `### Heading` in `## Test Scenarios` → one `it()` block.
4. Run tests — expect RED. Fix test code errors (bad imports, syntax), but leave stub failures as-is.
5. Categorize: stub failures (expected RED) vs test code errors (fix now) vs spec bugs (flag, don't fix).

If this is a **re-run after Audit findings**, also:

- Read the Audit Report findings
- Address MECHANICAL findings by fixing the implementation
- For DESIGN findings, adjust the implementation approach if you can, or flag if the spec itself needs revision

---

## Step 3: Implement

Follow the `implement-spec` procedure exactly as documented in `.claude/skills/implement-spec/SKILL.md`.

Summary:

1. Verify test file exists. If not, STOP.
2. Read the spec, source file, test file, dependency specs and source files.
3. Update spec frontmatter: `status: implementing`.
4. Replace stubs with working code. Implement requirements in numbered order.
5. Follow coding conventions:
   - Functional style, no classes for domain concepts
   - Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
   - JSDoc on all public exports
   - Handler signatures must match exactly
6. Run type check: `cd packages/core && npx tsc --noEmit`. Fix type errors in the implementation.
7. Do NOT modify test files. The spec is the authority.

---

## Step 4: Run Tests (GREEN)

Follow the `run-tests` procedure exactly as documented in `.claude/skills/run-tests/SKILL.md`.

Summary:

1. Run type check: `cd packages/core && npx tsc --noEmit`
2. Run tests: `cd packages/core && npx vitest run --reporter=verbose <test-file>`
3. If ALL GREEN → proceed to Build Report.
4. If some RED → analyze, loop back to Step 3. Repeat.
5. **Stuck detection**: If the SAME test fails 3 times with the same error → STOP. Write a partial Build Report with `Result: STUCK` and signal failure to the Orchestrator.

---

## Build Report

After Step 4 completes (GREEN or STUCK), write the Build Report.

**Path**: `specs/reports/<spec-name>.build-report.md`

Where `<spec-name>` is derived from the spec filename (e.g., `aggregate.spec.md` → `aggregate`).

### GREEN Report

```markdown
## Build Report: <spec title>

- **Spec**: <spec-path>
- **Source**: <source-file-path>
- **Tests**: <test-file-path>
- **Result**: GREEN
- **Tests passing**: <N>/<N>
- **Loop count**: <number of Step 3-4 iterations>

### Test Results

| Test        | Status |
| ----------- | ------ |
| <test name> | PASS   |

### Concerns

<any issues noticed during implementation, or "None">
```

### STUCK Report

```markdown
## Build Report: <spec title>

- **Spec**: <spec-path>
- **Source**: <source-file-path>
- **Tests**: <test-file-path>
- **Result**: STUCK
- **Tests passing**: <N>/<M>
- **Loop count**: <number of Step 3-4 iterations>

### Test Results

| Test        | Status      |
| ----------- | ----------- |
| <test name> | PASS / FAIL |

### Concerns

<description of what's blocking progress>

### Stuck Details

- **Stuck on**: <test name>
- **Error**: <error message>
- **Attempts**:
  1. <what was tried>
  2. <what was tried>
  3. <what was tried>
```

---

## Re-run Protocol (after Audit rejection)

When re-invoked with Audit findings:

1. Read the Audit Report at `specs/reports/<spec-name>.audit-report.md`.
2. For each MECHANICAL finding: apply the fix directly.
3. For each DESIGN finding: attempt to address it. If the finding requires a spec change, note this in your Build Report concerns.
4. Skip Step 2 (tests already exist) unless the Audit Report indicates test issues.
5. Run Step 3 (implement fixes) → Step 4 (confirm GREEN) → write new Build Report.
