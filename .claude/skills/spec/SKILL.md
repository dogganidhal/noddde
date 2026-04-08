---
name: spec
description: "Spec-driven development orchestrator. The single entry point for all spec work: creating features, fixing bugs, evolving APIs. Drives the full 6-step pipeline (spec → RED tests → implement → GREEN tests → validate → update docs) autonomously, only pausing for developer approval at gate points. Use when asked to 'add a feature', 'implement', 'fix a bug', 'change the API', 'new spec', 'edit spec', or any development task."
argument-hint: <description of what you want to build or change>
model: opus
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# Spec-Driven Development Orchestrator

You are the orchestrator of a 6-step spec-driven pipeline. The developer describes what they want. You plan, coordinate agents, and deliver — only pausing at gate points.

## Multi-Agent Architecture

The pipeline uses three roles:

| Role                   | Agent              | Steps | Purpose                                        |
| ---------------------- | ------------------ | ----- | ---------------------------------------------- |
| **Orchestrator** (you) | Main context       | 0-1   | Understand intent, write/edit spec, coordinate |
| **Builder**            | Sub-agent (Sonnet) | 2-4   | Generate RED tests, implement, run GREEN tests |
| **Auditor**            | Sub-agent (Opus)   | 5-6   | Independent validation, coherence review, docs |

The Builder and Auditor run in **separate agent contexts**. The Auditor has no memory of the Builder's work — it reviews with fresh eyes. Communication happens through **file artifacts** (Build Report, Audit Report).

## Pipeline Overview

```
  Gate 1 ──→ Step 1: SPEC           Write/edit the spec (you, directly)
    ↓
  (auto)  ──→ Steps 2-4: BUILD      [Builder agent] RED tests → implement → GREEN
    ↓
  (auto)  ──→ Steps 5-6: AUDIT      [Auditor agent] Validate + coherence + docs
    ↓
  (loop)  ──→ FEEDBACK LOOP          If Auditor FAILs → re-run Builder (max 2 cycles)
    ↓
  Report  ──→ Done
```

**Gate points** (where you pause for developer input):

- **Gate 1**: After planning the spec — "Here's what I'll spec. Approve?"
- **Breaking changes**: If detected during step 1 — "Breaking change. How to handle?"
- **Stuck loop**: If the Builder gets stuck (3+ failures on same test) — "Builder can't fix this. Here's what's happening."
- **Auditor CONCERN**: If the Auditor raises issues requiring developer judgment

**Everything else runs autonomously.** Don't ask for permission between steps.

---

## Step 0: Understand Intent

Determine what the developer wants:

| Developer says...                                             | Action                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| "Add <feature>" / "Create <module>" / "New <thing>"           | → New spec (full pipeline)                               |
| "Fix <bug>" / "Handle <edge case>"                            | → Edit existing spec (find it first)                     |
| "Change <API>" / "Rename <type>" / "Add field to <interface>" | → Edit existing spec (breaking change likely)            |
| "Implement <spec-path>"                                       | → Skip to Builder (spec already exists)                  |
| "The tests are failing on <spec>"                             | → Skip to Builder (tests exist, need implementation fix) |

If the developer provides a spec path, read it and determine which step to start from based on current state:

- Spec exists, no test file → start at Builder
- Spec exists, test file exists, tests RED → start at Builder
- Spec exists, tests GREEN → start at Auditor (validate)

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

**If no breaking changes**, proceed silently to the Builder.

---

## Spawn Builder Agent (Steps 2-4)

**Run autonomously — no gate.**

Spawn a sub-agent to execute the Builder role. The Builder will generate RED tests, implement code, and run tests until GREEN (or get stuck).

Use the `Agent` tool to spawn the Builder:

```
Agent(
  description: "Builder: RED tests → implement → GREEN for <spec-name>",
  model: "sonnet",
  prompt: <see below>
)
```

### Builder Prompt Template

Construct the prompt by including:

1. **The full contents of `.claude/skills/build-spec/SKILL.md`** (read it and include it)
2. **The project's coding conventions from `CLAUDE.md`** (include the Coding Conventions section)
3. **The spec path and any context**:

```
## Your Task

Execute the Builder pipeline for:
- Spec: <spec-path>

<if re-run after audit>
This is a re-run. Read the Audit Report at specs/reports/<spec-name>.audit-report.md
and address all findings before proceeding.
</if>

Follow the build-spec procedure above. Write the Build Report when done.
```

### After Builder Completes

1. Read the Build Report at `specs/reports/<spec-name>.build-report.md`.
2. If `Result: GREEN` → proceed to spawn the Auditor.
3. If `Result: STUCK` → escalate to the developer:

```
🔴 Builder stuck on: <spec title>

<stuck details from Build Report>

This might indicate:
  - A spec requirement that's ambiguous or contradictory
  - A dependency that isn't implemented yet
  - A fundamental design issue

How would you like to proceed?
```

---

## Spawn Auditor Agent (Steps 5-6)

**Run autonomously — no gate (unless CONCERN).**

Spawn a sub-agent to execute the Auditor role. The Auditor validates independently and updates docs.

Use the `Agent` tool to spawn the Auditor:

```
Agent(
  description: "Auditor: validate + review + docs for <spec-name>",
  model: "opus",
  prompt: <see below>
)
```

### Auditor Prompt Template

Construct the prompt by including:

1. **The full contents of `.claude/skills/audit-spec/SKILL.md`** (read it and include it)
2. **The project's coding conventions from `CLAUDE.md`** (include the Coding Conventions section)
3. **The spec path and cycle number**:

```
## Your Task

Execute the Auditor pipeline for:
- Spec: <spec-path>
- Build Report: specs/reports/<spec-name>.build-report.md
- Cycle: <1 or 2>

Follow the audit-spec procedure above. Write the Audit Report when done.
```

### After Auditor Completes

1. Read the Audit Report at `specs/reports/<spec-name>.audit-report.md`.
2. Handle the verdict:

#### PASS

Pipeline complete. Proceed to the Final Report.

#### FAIL (cycle 1)

Re-spawn the Builder with audit findings:

1. Report briefly to the developer:
   ```
   🔄 Auditor found issues. Re-running Builder (cycle 2/2).
   Findings: <brief summary from Audit Report>
   ```
2. Spawn the Builder again with the re-run prompt (it will read the Audit Report).
3. After Builder completes, spawn the Auditor again with `Cycle: 2`.

#### FAIL (cycle 2)

The Builder-Auditor loop has reached its limit. Escalate remaining issues to the developer:

```
⚠️  Auditor found persistent issues after 2 cycles:

<findings from cycle 2 Audit Report>

Options:
  1. Accept as-is (mark implemented with notes)
  2. I'll fix these manually
  3. Revise the spec to accommodate the implementation

Which approach?
```

#### CONCERN

Escalate to the developer immediately:

```
🤔 Auditor raised concerns requiring your judgment:

<concerns from Audit Report>

How would you like to proceed?
```

---

## Final Report

Present the complete result:

```
✅ Pipeline complete: <spec title>

  Step 1: Spec written       → <spec-path>
  Steps 2-4: Builder         → <source-path> (<N> tests, <M> loops)
  Steps 5-6: Auditor         → <verdict> (<N> pages updated)

  Status: implemented
  Breaking changes: <none | managed via deprecation | accepted>
  Builder-Auditor cycles: <1 or 2>

  Artifacts:
    Build Report:  specs/reports/<spec-name>.build-report.md
    Audit Report:  specs/reports/<spec-name>.audit-report.md
```

If there are remaining gaps from the Auditor:

```
⚠️  Minor gaps (non-blocking):
  - <from Audit Report>

These are noted but don't block the `implemented` status.
```
