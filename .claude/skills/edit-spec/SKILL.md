---
name: edit-spec
description: "Internal procedure for Step 1 (edit). Use /spec instead — it orchestrates the full pipeline. This skill contains detailed instructions for editing an existing spec with breaking change detection."
user-invocable: false
model: opus
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# Step 1 (edit path): Edit an Existing Spec

Modify a behavioral specification while detecting breaking changes and managing downstream impact.

**Pipeline step 1 of 6** (edit spec path). Called by the `/spec` orchestrator.

## Step 1: Load Context

1. **Read the spec** at the path provided (or find it: replace `packages/core/src/` with `specs/core/` and `.ts` with `.spec.md`)
2. **Snapshot the current state** before making changes — remember:
   - Current `exports` list
   - Current type signatures in `## Type Contract`
   - Current behavioral requirements (numbered list)
   - Current handler signatures
   - Current `depends_on` list
3. **Read the source file** referenced in `source_file` to understand current implementation state
4. **Read downstream specs** — find all specs whose `depends_on` includes this module:
   ```
   grep -rl "<this-module-path>" specs/core/ specs/integration/
   ```

## Step 2: Understand the Change

Classify the requested change:

| Change type          | Examples                                                                 | Risk level              |
| -------------------- | ------------------------------------------------------------------------ | ----------------------- |
| **Additive**         | New export, new behavioral requirement, new edge case, new test scenario | Safe                    |
| **Clarification**    | Reword requirement, add detail to type contract, fix typo                | Safe                    |
| **Narrowing**        | Tighten a return type, add a required field, remove an optional behavior | ⚠️ Potentially breaking |
| **Widening**         | Accept more input types, make a field optional, add a union variant      | Usually safe            |
| **Removal**          | Remove an export, delete a behavioral requirement, drop a handler        | 🔴 Breaking             |
| **Signature change** | Different parameters, different return type, renamed type                | 🔴 Breaking             |

## Step 3: Make the Changes

Apply the requested modifications to the spec. For each section touched:

- **Type Contract**: Update signatures, add/remove exports, update frontmatter `exports` list
- **Behavioral Requirements**: Re-number if needed, ensure consistency with type contract
- **Invariants**: Check if new requirements create new invariants or invalidate old ones
- **Edge Cases**: Add new edge cases implied by the change
- **Test Scenarios**: Add/update test code blocks to cover the changed behavior
- **Integration Points**: Update if the module's relationship to others changes

## Step 4: Breaking Change Analysis

Compare the snapshot (Step 1) against the new state (Step 3).

Follow the procedure in `.claude/skills/shared/breaking-changes.md` for detection criteria, impact analysis, developer prompt, and resolution options.

**If no breaking changes detected**, proceed directly to Step 5.

## Step 5: Update Spec Status

- If the spec was `implemented` and the type contract or behavioral requirements changed → set to `ready` (needs re-implementation)
- If only test scenarios were added → keep as `implemented` (tests just need regeneration)
- If the spec was `draft` or `ready` → keep current status

## Step 6: Summary

Show the developer:

```
✅ Spec updated: <spec-path>

Changes made:
  - <bullet list of changes>

Status: <new status>
Breaking: <none | managed via deprecation | accepted>

Next step:
  Run `/generate-tests <spec-path>` to regenerate tests (expect RED for new/changed scenarios)
```
