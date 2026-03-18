---
name: edit-spec
description: "Internal procedure for Step 1 (edit). Use /spec instead — it orchestrates the full pipeline. This skill contains detailed instructions for editing an existing spec with breaking change detection."
user-invocable: false
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# Step 1 (edit path): Edit an Existing Spec

Modify a behavioral specification while detecting breaking changes and managing downstream impact.

This is **step 1** of the 6-step pipeline (the "edit" variant):

```
→ 1. /edit-spec          Modify the spec (type contract, requirements, test scenarios)
  2. /generate-tests      Regenerate tests (RED — new/changed tests failing)
  3. /implement-spec      Update the implementation (no test generation)
  4. /run-tests           Run tests (GREEN — all passing)
  5. /validate-spec       Cross-check spec vs implementation
  6. /update-docs         Update documentation pages
```

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

| Change type | Examples | Risk level |
|------------|----------|------------|
| **Additive** | New export, new behavioral requirement, new edge case, new test scenario | Safe |
| **Clarification** | Reword requirement, add detail to type contract, fix typo | Safe |
| **Narrowing** | Tighten a return type, add a required field, remove an optional behavior | ⚠️ Potentially breaking |
| **Widening** | Accept more input types, make a field optional, add a union variant | Usually safe |
| **Removal** | Remove an export, delete a behavioral requirement, drop a handler | 🔴 Breaking |
| **Signature change** | Different parameters, different return type, renamed type | 🔴 Breaking |

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

### Automatic Checks

Run through each of these. If ANY trigger, the change is breaking:

1. **Removed export**: An item in the old `exports` list is no longer present
2. **Renamed export**: An export name changed (removal + addition of similar item)
3. **Changed function signature**:
   - Parameters added (without defaults)
   - Parameter types narrowed (e.g., `string | number` → `string`)
   - Return type changed in an incompatible way
4. **Changed interface shape**:
   - Required field added to an existing interface
   - Field type narrowed
   - Field removed
5. **Weakened behavioral guarantee**: A requirement that downstream specs rely on is removed or softened
6. **Changed handler signature pattern**: Any of the 6 handler signatures (command, apply, event, saga, query, projection reducer) is modified

### If No Breaking Changes Detected

Proceed directly to Step 5.

### If Breaking Changes Detected

Present the analysis to the developer:

```
⚠️  Breaking change detected while editing: <spec title>

Changes that break the public API:
  1. <specific change description>
  2. <specific change description>

Downstream impact:
  Specs that depend on this module:
    - <spec-path> (uses: <affected export>)
    - <spec-path> (uses: <affected export>)

  Sample code that uses affected exports:
    - <file>:<line> — uses <export>

Severity: <minor if 0.x | major if >=1.0>
```

Then ask:

```
How would you like to handle this?

  1. Make it additive — keep the old API, add the new one alongside it
  2. Deprecate and migrate — mark old API as @deprecated, add migration notes
  3. Accept the break — update all downstream specs and samples
  4. Abort — revert the spec change
```

**If option 1 (additive)**:
- Keep old exports in the type contract
- Add new exports alongside
- Update `exports` frontmatter to include both

**If option 2 (deprecate)**:
- Add `@deprecated` annotation to old types in the type contract
- Add a `## Migration` section to the spec:
  ```markdown
  ## Migration

  ### From `OldTypeName` to `NewTypeName` (since <version>)
  - `OldTypeName` is deprecated and will be removed in the next major version
  - Replace `OldTypeName` with `NewTypeName`
  - Change: <description of what changed and why>
  ```
- Add `## Deprecations` to the spec frontmatter for tracking

**If option 3 (accept)**:
- List every downstream spec that needs updating
- For each: describe the specific change needed
- Ask the developer: "Shall I update all <N> downstream specs now, or flag them for manual review?"
- If updating: edit each downstream spec's type contract, behavioral requirements, and test scenarios
- After all updates: verify the full dependency chain is consistent
- **Version inference**: Check `packages/core/package.json` for current version
  - If `0.x.y`: note "pre-1.0, breaking changes expected in minor bumps"
  - If `>=1.0.0`: state "this requires a major version bump to <next major>"

**If option 4 (abort)**:
- Revert all changes to the spec
- Confirm to the developer

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
