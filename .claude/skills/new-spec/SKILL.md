---
name: new-spec
description: "Internal procedure for Step 1 (new). Use /spec instead — it orchestrates the full pipeline. This skill contains detailed instructions for creating a new behavioral spec."
user-invocable: false
model: opus
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# Step 1: Create a New Spec

Create a behavioral specification for a new or existing module in the noddde framework.

**Pipeline step 1 of 6** (new spec path). Called by the `/spec` orchestrator.

## Step 1: Understand Intent

Ask the developer (if not already clear from context):

- **What kind of module?** Aggregate, projection, saga, bus implementation, persistence implementation, or standalone?
- **Which source file?** Existing file to spec, or new file to create?
- **What problem does it solve?** One-sentence purpose.

## Step 2: Select Template

Pick the right template from `specs/templates/`:

| Module type                                         | Template                                                      |
| --------------------------------------------------- | ------------------------------------------------------------- |
| Aggregate                                           | `specs/templates/aggregate.spec.template.md`                  |
| Projection                                          | `specs/templates/projection.spec.template.md`                 |
| Saga                                                | `specs/templates/saga.spec.template.md`                       |
| Bus implementation (EventBus, CommandBus, QueryBus) | `specs/templates/bus-implementation.spec.template.md`         |
| Persistence implementation                          | `specs/templates/persistence-implementation.spec.template.md` |
| Other (handler type, utility, infrastructure)       | Start from the closest existing spec in `specs/core/`         |

Read the selected template to understand the expected sections.

## Step 3: Determine Spec Location

The spec path mirrors the source path:

- Source: `packages/core/src/<path>/<file>.ts`
- Spec: `specs/core/<path>/<name>.spec.md`

Example: `packages/core/src/engine/implementations/postgres-event-store.ts` → `specs/core/engine/implementations/postgres-event-store.spec.md`

## Step 4: Identify Dependencies

Read existing specs that this module will depend on. Use the `depends_on` graph:

- Search `specs/core/` for specs that export types this module will consume
- Read those specs to understand the contracts you're building on
- List them in the `depends_on` frontmatter field

## Step 5: Write the Spec

Fill in every section:

1. **Frontmatter**: title, module, source_file, `status: draft`, exports list, depends_on list
2. **Type Contract**: Every exported type, interface, function with full signatures
3. **Behavioral Requirements**: Numbered guarantees — these are the contract
4. **Invariants**: Always/never conditions
5. **Edge Cases**: Boundary conditions, error states, empty inputs
6. **Integration Points**: How it connects to other modules
7. **Test Scenarios**: Vitest-compatible code blocks, each `###` = one `it()` block

**Important**: The `## Test Scenarios` section must be thorough. These become the red tests in step 2 that prove the spec is testable before any code is written.

## Step 6: Breaking Change Analysis

**This step is critical.** Before finalizing the spec, analyze whether it introduces breaking changes to existing APIs.

Follow the procedure in `.claude/skills/shared/breaking-changes.md` for detection criteria, impact analysis, developer prompt, and resolution options.

## Step 7: Finalize

1. Write the spec file to the determined path
2. Set `status: draft`
3. Show the developer a summary:
   - Spec path
   - Exports defined
   - Dependencies
   - Test scenarios count
   - Breaking change status (none / managed / accepted)
4. **Next step**: Prompt the developer:

```
Spec written: <spec-path>
Status: draft

Next steps:
  1. Review the spec and set status to `ready` when approved
  2. Run `/generate-tests <spec-path>` to generate RED tests
```
