---
name: new-spec
description: "Internal procedure for Step 1 (new). Use /spec instead — it orchestrates the full pipeline. This skill contains detailed instructions for creating a new behavioral spec."
user-invocable: false
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# Step 1: Create a New Spec

Create a behavioral specification for a new or existing module in the noddde framework.

This is **step 1** of the 6-step spec-driven development pipeline:

```
→ 1. /new-spec          Write the spec (API, invariants, test scenarios)
  2. /generate-tests     Generate tests from spec (RED — all failing)
  3. /implement-spec     Implement the code (no test generation)
  4. /run-tests          Run tests (GREEN — all passing)
  5. /validate-spec      Cross-check spec vs implementation
  6. /update-docs        Update documentation pages
```

## Step 1: Understand Intent

Ask the developer (if not already clear from context):
- **What kind of module?** Aggregate, projection, saga, bus implementation, persistence implementation, or standalone?
- **Which source file?** Existing file to spec, or new file to create?
- **What problem does it solve?** One-sentence purpose.

## Step 2: Select Template

Pick the right template from `specs/templates/`:

| Module type | Template |
|------------|----------|
| Aggregate | `specs/templates/aggregate.spec.template.md` |
| Projection | `specs/templates/projection.spec.template.md` |
| Saga | `specs/templates/saga.spec.template.md` |
| Bus implementation (EventBus, CommandBus, QueryBus) | `specs/templates/bus-implementation.spec.template.md` |
| Persistence implementation | `specs/templates/persistence-implementation.spec.template.md` |
| Other (handler type, utility, infrastructure) | Start from the closest existing spec in `specs/core/` |

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

### Detection

Check each of these conditions:

1. **Modified type contracts**: Does this spec change the signature of any type or function already exported by an existing spec?
   - Search: `grep -r "exports:" specs/core/ specs/integration/` and cross-reference with the new spec's type contract
   - Look for: renamed fields, changed parameter types, narrowed return types, removed optional fields

2. **Altered behavioral requirements**: Does this spec weaken or change guarantees made by existing specs?
   - Read the `depends_on` specs — does the new spec expect something different from them?
   - Read specs that depend on the module being modified — do they still hold?

3. **New required fields on existing types**: If the new feature adds a required field to `DomainConfiguration`, `Aggregate`, `Projection`, `Saga`, or any other widely-used type, that's breaking.

4. **Changed handler signatures**: If command handler, apply handler, event handler, query handler, or saga handler signatures change, that breaks all sample domains and user code.

### Impact Radius

If a breaking change is detected:

1. **Walk the dependency graph**: Read the `depends_on` field of ALL specs in `specs/core/` and `specs/integration/`. Build a list of every spec that transitively depends on the changed module.
2. **Check sample domains**: Search `packages/samples/src/` for usage of the affected exports.
3. **Report the impact**: Show the developer exactly what breaks and where.

### Developer Prompt

Present findings to the developer and ask:

```
⚠️  Breaking change detected in: <module>

Changed: <what changed>
Impact radius: <N> specs, <M> sample files

Affected specs:
  - specs/core/ddd/aggregate.spec.md (uses <export>)
  - specs/integration/command-dispatch-lifecycle.spec.md (tests <behavior>)

Affected samples:
  - packages/samples/src/auction/aggregate.ts (line N)
  - packages/samples/src/banking/aggregate.ts (line N)

Options:
  1. Add the change as a NEW export (non-breaking, additive)
  2. Deprecate the old API and add the new one alongside it
  3. Accept the breaking change (requires major version bump)

Which approach?
```

### If Breaking Change Accepted

Add these extra steps to the workflow:

1. **Version inference**: If the current version is `0.x.y`, note that breaking changes are expected. If `>=1.0.0`, infer next major version.
2. **Deprecation markers**: If option 2 chosen, add `@deprecated` JSDoc to old exports in the type contract, with a migration note pointing to the new API.
3. **Migration notes**: Add a `## Migration` section to the spec describing what consumers need to change.
4. **Update affected specs**: List the specs that need their `depends_on`, type contracts, or test scenarios updated. Do NOT auto-update them — flag them for the developer.
5. **Update CHANGELOG**: If a CHANGELOG exists, draft an entry under `## [Unreleased]` with a `### Breaking Changes` section.

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
