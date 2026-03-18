---
name: spec
description: "Spec-driven development orchestrator. The single entry point for all spec work: creating features, fixing bugs, evolving APIs. Drives the full 6-step pipeline (spec → RED tests → implement → GREEN tests → validate → update docs) autonomously, only pausing for developer approval at gate points. Use when asked to 'add a feature', 'implement', 'fix a bug', 'change the API', 'new spec', 'edit spec', or any development task."
argument-hint: <description of what you want to build or change>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# Spec-Driven Development Orchestrator

You are the orchestrator of a 6-step spec-driven pipeline. The developer describes what they want. You plan, execute, loop, and deliver — only pausing at gate points.

## Pipeline Overview

```
  Gate 1 ──→ Step 1: SPEC         Write/edit the spec
    ↓
  (auto)  ──→ Step 2: TEST (RED)   Generate tests, confirm they fail
    ↓
  (auto)  ──→ Step 3: IMPLEMENT    Write code to make tests pass
    ↓
  (loop)  ──→ Step 4: TEST (GREEN) Run tests — loop back to step 3 if RED
    ↓
  (auto)  ──→ Step 5: VALIDATE     Final cross-check
    ↓
  (auto)  ──→ Step 6: DOCS         Update documentation pages
    ↓
  Report  ──→ Done
```

**Gate points** (where you pause for developer input):
- **Gate 1**: After planning the spec — "Here's what I'll spec. Approve?"
- **Breaking changes**: If detected during step 1 — "Breaking change. How to handle?"
- **Stuck loop**: If step 3↔4 fails 3+ times on the same test — "I can't fix this. Here's what's happening."

**Everything else runs autonomously.** Don't ask for permission between steps 2→3→4→5→6.

---

## Step 0: Understand Intent

Determine what the developer wants:

| Developer says... | Action |
|------------------|--------|
| "Add <feature>" / "Create <module>" / "New <thing>" | → New spec (full pipeline) |
| "Fix <bug>" / "Handle <edge case>" | → Edit existing spec (find it first) |
| "Change <API>" / "Rename <type>" / "Add field to <interface>" | → Edit existing spec (breaking change likely) |
| "Implement <spec-path>" | → Skip to step 2 (spec already exists) |
| "The tests are failing on <spec>" | → Skip to step 3 (tests exist, need implementation fix) |

If the developer provides a spec path, read it and determine which step to start from based on current state:
- Spec exists, no test file → start at step 2
- Spec exists, test file exists, tests RED → start at step 3
- Spec exists, tests GREEN → start at step 5 (validate)

---

## Step 1: Write or Edit the Spec

### For NEW specs

**Plan** (show to developer at Gate 1):

1. Read the relevant template from `specs/templates/` based on module type:
   | Module type | Template |
   |------------|----------|
   | Aggregate | `specs/templates/aggregate.spec.template.md` |
   | Projection | `specs/templates/projection.spec.template.md` |
   | Saga | `specs/templates/saga.spec.template.md` |
   | Bus implementation | `specs/templates/bus-implementation.spec.template.md` |
   | Persistence implementation | `specs/templates/persistence-implementation.spec.template.md` |
   | Other | Start from the closest existing spec in `specs/core/` |

2. Identify dependencies — search `specs/core/` for specs that export types this module will consume.

3. Draft the spec outline and present at **Gate 1**:
   ```
   📋 Spec Plan: <title>

   Location: specs/core/<path>/<name>.spec.md
   Source file: packages/core/src/<path>/<name>.ts
   Exports: <list>
   Dependencies: <list>

   Type Contract (summary):
     - <type/function signature summaries>

   Behavioral Requirements:
     1. <requirement>
     2. <requirement>
     ...

   Test Scenarios: <N> planned

   Approve this plan? (or give feedback)
   ```

4. **Wait for developer approval.** If they give feedback, revise and re-present.

5. Once approved, write the full spec with all sections:
   - Frontmatter (title, module, source_file, `status: ready`, exports, depends_on)
   - Type Contract (full signatures)
   - Behavioral Requirements (numbered)
   - Invariants
   - Edge Cases
   - Integration Points
   - Test Scenarios (complete vitest code blocks)

### For EDITING existing specs

1. Read the spec and snapshot current state (exports, type signatures, requirements).
2. Read downstream specs (`grep -rl "<module-path>" specs/core/ specs/integration/`).
3. Draft the changes and present at **Gate 1**:
   ```
   📋 Spec Edit Plan: <title>

   Changes:
     - <what will change>

   Sections affected: <list>
   New test scenarios: <N>

   Approve? (or give feedback)
   ```
4. **Wait for approval**, then apply changes.

### Breaking Change Detection (sub-gate)

After writing/editing, automatically check for breaking changes:

1. **Removed or renamed exports** from the `exports` list
2. **Changed function signatures** (new required params, narrowed types, changed returns)
3. **Changed interface shapes** (new required fields, removed fields, narrowed field types)
4. **Changed handler signature patterns** (any of the 6 handler types)
5. **Weakened behavioral guarantees** that downstream specs rely on

**If breaking change detected**, pause and present:

```
⚠️  Breaking change detected: <what changed>

Impact: <N> downstream specs, <M> sample files
  - <spec-path> (uses <export>)
  - <sample-file>:<line>

Options:
  1. Make it additive (keep old API, add new alongside)
  2. Deprecate old API (@deprecated + migration notes)
  3. Accept the break (version bump required)

Which approach?
```

Wait for developer choice, then:
- **Additive**: keep old exports, add new ones
- **Deprecate**: add `@deprecated` JSDoc, write `## Migration` section, note version
- **Accept**: infer version bump (minor for 0.x, major for ≥1.0), flag downstream specs for update

**If no breaking changes**, proceed silently to step 2.

---

## Step 2: Generate Tests (RED)

**Run autonomously — no gate.**

1. Determine test file path:
   - `specs/core/<path>/<name>.spec.md` → `packages/core/src/__tests__/<path>/<name>.test.ts`
   - `specs/integration/<name>.spec.md` → `packages/core/src/__tests__/integration/<name>.test.ts`

2. Create parent directories if needed.

3. Generate the test file:
   - Each `### Heading` in `## Test Scenarios` → one `it()` block
   - Group under `describe("<spec title>", () => { ... })`
   - Use `import { ... } from "@noddde/core"` for framework imports
   - Use `expectTypeOf` for type-level assertions, `expect` for runtime assertions
   - If test file already exists: add new tests, update changed tests, preserve manually-added tests

4. Run the tests:
   ```bash
   cd packages/core && CODEARTIFACT_AUTH_TOKEN="" npx vitest run --reporter=verbose <test-file>
   ```

5. **Expect RED.** Categorize results:
   - Tests failing because implementation is a stub → correct (RED)
   - Tests failing because of test code errors → fix the test code NOW, then re-run
   - Type-level tests passing → fine (types may already exist)

6. Report briefly and continue:
   ```
   🔴 Step 2 complete: <N> tests generated, <M> RED (expected). Proceeding to implementation.
   ```

---

## Step 3: Implement

**Run autonomously — no gate.**

1. Read the spec, source file, existing RED tests, and dependency source files.

2. Update spec frontmatter: `status: implementing`

3. Replace `throw new Error("Not implemented")` stubs with working code.
   - Implement behavioral requirements in numbered order
   - Follow conventions from CLAUDE.md:
     - Functional style: no classes for domain concepts
     - Strict TypeScript: `strict: true`, `noUncheckedIndexedAccess: true`
     - JSDoc on all public exports
     - Handler signatures must match exactly
   - Do NOT modify the test file

4. Run type check:
   ```bash
   cd packages/core && npx tsc --noEmit
   ```
   Fix type errors in the implementation (not in tests — the spec is the authority).

5. Proceed directly to step 4.

---

## Step 4: Run Tests (GREEN)

**Run autonomously — loop back to step 3 if needed.**

1. Run tests:
   ```bash
   cd packages/core && CODEARTIFACT_AUTH_TOKEN="" npx vitest run --reporter=verbose <test-file>
   ```

2. **If ALL GREEN**: proceed to step 5.

3. **If some RED**: analyze each failure:
   - Is it a missing implementation? → go back to step 3, implement the specific requirement
   - Is it a bug in the implementation? → go back to step 3, fix the bug
   - Is it a test code issue? → fix the test (but flag it — the spec may need updating)

4. **Loop**: go back to step 3 → fix → step 4 → test. Repeat.

5. **Stuck detection**: If the SAME test fails 3 times in a row with the same error, STOP and escalate:
   ```
   🔴 Stuck on test: "<test name>"

   Error (3 consecutive failures):
     <error message>

   What I've tried:
     1. <attempt 1>
     2. <attempt 2>
     3. <attempt 3>

   This might indicate:
     - A spec requirement that's ambiguous or contradictory
     - A dependency that isn't implemented yet
     - A fundamental design issue

   How would you like to proceed?
   ```

---

## Step 5: Validate

**Run autonomously — no gate.**

1. **Export coverage**: Compare spec `exports` frontmatter vs source file actual exports.
2. **Behavioral requirements**: For each numbered requirement, check: implemented + tested?
3. **Invariants**: For each invariant, check: enforced by types or runtime? Tested?
4. **Edge cases**: For each edge case, check: handled? Tested?
5. **Stub check**: `grep -n "throw new Error" <source-file>` — must be zero.
6. **Final test run**: Run tests one more time to confirm GREEN.

Update spec frontmatter: `status: implemented`

---

## Step 6: Update Documentation

**Run autonomously — no gate.**

1. Read the spec's `docs` frontmatter field for explicitly mapped documentation pages.
2. Grep `packages/docs/content/docs/` for references to the spec's exports (discover additional pages).
3. For each affected documentation page:
   - Update code examples that use changed API signatures
   - Update explanatory text if behavioral requirements changed
   - Add deprecation notices if applicable
4. If this is a new spec (new module), create stub documentation pages in the appropriate category under `packages/docs/content/docs/` and update the category's `meta.json`.
5. Flag auto-generated API reference pages (in `packages/docs/src/content/docs/api/`) for regeneration if exports changed — do NOT manually edit them.
6. Report briefly and continue to the Final Report:
   ```
   📖 Step 6 complete: Documentation updated
     Pages updated: <N>
     Pages created: <N>
     API reference: <status>
     Flagged for review: <N>
   ```

If no documentation updates are needed (internal-only change, no API surface affected):
   ```
   📖 Step 6 complete: No documentation updates needed
   ```

---

## Final Report

Present the complete result:

```
✅ Pipeline complete: <spec title>

  Step 1: Spec written     → <spec-path>
  Step 2: Tests generated  → <test-path> (<N> scenarios)
  Step 3: Implemented      → <source-path>
  Step 4: Tests GREEN      → <N>/<N> passing
  Step 5: Validated        → <coverage summary>
  Step 6: Docs updated     → <N> pages updated, <M> created

  Status: implemented
  Breaking changes: <none | managed via deprecation | accepted>
  Implementation loops: <N> (step 3↔4 iterations)
```

If there are remaining gaps from validation:
```
⚠️  Minor gaps (non-blocking):
  - Invariant "<name>" not enforced at runtime (type-level only)
  - Edge case "<name>" not tested (covered by implementation)

These are noted but don't block the `implemented` status.
```
